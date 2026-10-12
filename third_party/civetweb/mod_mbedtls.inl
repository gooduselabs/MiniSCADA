#if defined(USE_MBEDTLS) // USE_MBEDTLS used with NO_SSL

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/debug.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"

#if MBEDTLS_VERSION_NUMBER >= 0x03000000
// The file include/mbedtls/net.h was removed in v3.0.0 because its only
// function was to include mbedtls/net_sockets.h which now should be included
// directly.
#include "mbedtls/net_sockets.h"
#else
#include "mbedtls/net.h"
#endif

#include "mbedtls/pk.h"
#include "mbedtls/platform.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509.h"
#include "mbedtls/x509_crt.h"
#include <string.h>

typedef mbedtls_ssl_context SSL;

typedef struct {
	mbedtls_ssl_config conf;         /* SSL configuration */
	mbedtls_x509_crt cert;           /* Certificate */
	mbedtls_ctr_drbg_context ctr;    /* Counter random generator state */
	mbedtls_entropy_context entropy; /* Entropy context */
	mbedtls_pk_context pkey;         /* Private key */
} SSL_CTX;


/* mAT patch 3 (feature 005, see third_party/LICENSES.md): bounded handshake.
 * The worker gets the client socket in non-blocking mode, and upstream called
 * mbedtls_ssl_handshake() again at once on WANT_READ/WANT_WRITE: a client that
 * opened TCP and stayed silent kept a worker at 100 % CPU until it went away,
 * and mg_stop() waited for it. mbed_ssl_handshake() now sleeps in poll() on the
 * direction Mbed TLS needs, gives the whole handshake at most the context's
 * request_timeout_ms (like sslize() of the OpenSSL build) and ends when the
 * server stops. This file is included before stop_flag_t is declared, so
 * mbed_ssl_accept() reads the stop flag as the volatile int it is without
 * STOP_FLAG_NEEDS_LOCK. */
#if defined(STOP_FLAG_NEEDS_LOCK)
#error "mAT patch 3 reads the stop flag as a volatile int"
#endif

/* mAT patch 3: handshake limit when request_timeout_ms is not positive ("0"
 * or less means no request timeout in CivetWeb, but a handshake must end): the
 * CivetWeb default of request_timeout_ms, the value pull_all() falls back to. */
#if !defined(MG_MAT_TLS_HANDSHAKE_DEFAULT_MS)
#define MG_MAT_TLS_HANDSHAKE_DEFAULT_MS (30000)
#endif

/* public api */
int mbed_sslctx_init(SSL_CTX *ctx, const char *crt);
void mbed_sslctx_uninit(SSL_CTX *ctx);
void mbed_ssl_close(mbedtls_ssl_context *ssl);
int mbed_ssl_accept(mbedtls_ssl_context **ssl,
                    SSL_CTX *ssl_ctx,
                    int *sock,
                    struct mg_context *phys_ctx,
                    const char *request_timeout_ms,
                    const volatile int *stop_flag);
int mbed_ssl_read(mbedtls_ssl_context *ssl, unsigned char *buf, int len);
int mbed_ssl_write(mbedtls_ssl_context *ssl, const unsigned char *buf, int len);

static void mbed_debug(void *context,
                       int level,
                       const char *file,
                       int line,
                       const char *str);
static int mbed_ssl_handshake(mbedtls_ssl_context *ssl,
                              int sock,
                              int timeout_ms,
                              const volatile int *stop_flag);


int
mbed_sslctx_init(SSL_CTX *ctx, const char *crt)
{
	mbedtls_ssl_config *conf;
	int rc;

	if (ctx == NULL || crt == NULL) {
		return -1;
	}

	DEBUG_TRACE("%s", "Initializing MbedTLS SSL");
	mbedtls_entropy_init(&ctx->entropy);

	conf = &ctx->conf;
	mbedtls_ssl_config_init(conf);

	/* Set mbedTLS debug level by defining MG_CONFIG_MBEDTLS_DEBUG:
	 *   0 No debug = mbedTLS DEFAULT
	 *   1 Error (default if "DEBUG" is set for CivetWeb)
	 *	 2 State change
	 *	 3 Informational
	 *	 4 Verbose
	 */
#if defined(DEBUG) || defined(MG_CONFIG_MBEDTLS_DEBUG)
#if defined(MG_CONFIG_MBEDTLS_DEBUG)
	mbedtls_debug_set_threshold(MG_CONFIG_MBEDTLS_DEBUG);
#else
	mbedtls_debug_set_threshold(1);
#endif
	mbedtls_ssl_conf_dbg(conf, mbed_debug, (void *)ctx);
#endif

	/* Initialize TLS key and cert */
	mbedtls_pk_init(&ctx->pkey);
	mbedtls_ctr_drbg_init(&ctx->ctr);
	mbedtls_x509_crt_init(&ctx->cert);

	rc = mbedtls_ctr_drbg_seed(&ctx->ctr,
	                           mbedtls_entropy_func,
	                           &ctx->entropy,
	                           (unsigned char *)"CivetWeb",
	                           strlen("CivetWeb"));
	if (rc != 0) {
		DEBUG_TRACE("TLS random seed failed (%i)", rc);
		return -1;
	}

#if MBEDTLS_VERSION_NUMBER >= 0x03000000
	// mbedtls_pk_parse_keyfile() has changed in mbedTLS 3.0. You now need
	// to pass a properly seeded, cryptographically secure RNG when calling
	// these functions. It is used for blinding, a countermeasure against
	// side-channel attacks.
	// https://github.com/Mbed-TLS/mbedtls/blob/development/docs/3.0-migration-guide.md#some-functions-gained-an-rng-parameter
	rc = mbedtls_pk_parse_keyfile(
	    &ctx->pkey, crt, NULL, mbedtls_ctr_drbg_random, &ctx->ctr);
#else
	rc = mbedtls_pk_parse_keyfile(&ctx->pkey, crt, NULL);
#endif
	if (rc != 0) {
		DEBUG_TRACE("TLS parse key file failed (%i)", rc);
		return -1;
	}

	rc = mbedtls_x509_crt_parse_file(&ctx->cert, crt);
	if (rc != 0) {
		DEBUG_TRACE("TLS parse crt file failed (%i)", rc);
		return -1;
	}

	rc = mbedtls_ssl_config_defaults(conf,
	                                 MBEDTLS_SSL_IS_SERVER,
	                                 MBEDTLS_SSL_TRANSPORT_STREAM,
	                                 MBEDTLS_SSL_PRESET_DEFAULT);
	if (rc != 0) {
		DEBUG_TRACE("TLS set defaults failed (%i)", rc);
		return -1;
	}

	mbedtls_ssl_conf_rng(conf, mbedtls_ctr_drbg_random, &ctx->ctr);

	/* Set auth mode if peer cert should be verified */
	mbedtls_ssl_conf_authmode(conf, MBEDTLS_SSL_VERIFY_NONE);
	mbedtls_ssl_conf_ca_chain(conf, NULL, NULL);

	/* Configure server cert and key */
	rc = mbedtls_ssl_conf_own_cert(conf, &ctx->cert, &ctx->pkey);
	if (rc != 0) {
		DEBUG_TRACE("TLS cannot set certificate and private key (%i)", rc);
		return -1;
	}
	return 0;
}


void
mbed_sslctx_uninit(SSL_CTX *ctx)
{
	mbedtls_ctr_drbg_free(&ctx->ctr);
	mbedtls_pk_free(&ctx->pkey);
	mbedtls_x509_crt_free(&ctx->cert);
	mbedtls_entropy_free(&ctx->entropy);
	mbedtls_ssl_config_free(&ctx->conf);
}


int
mbed_ssl_accept(mbedtls_ssl_context **ssl,
                SSL_CTX *ssl_ctx,
                int *sock,
                struct mg_context *phys_ctx,
                const char *request_timeout_ms,
                const volatile int *stop_flag)
{
	int rc;
	int timeout_ms;
	(void)phys_ctx; /* unused, if server statistics is not turned on */

	DEBUG_TRACE("TLS accept processing %p", ssl);

	*ssl = (mbedtls_ssl_context *)mg_calloc_ctx(1,
	                                            sizeof(mbedtls_ssl_context),
	                                            phys_ctx);
	if (*ssl == NULL) {
		DEBUG_TRACE("TLS accept: malloc ssl failed (%i)",
		            (int)sizeof(mbedtls_ssl_context));
		return -1;
	}

	mbedtls_ssl_init(*ssl);
	/* mAT patch 4: a failed setup (out of memory) leaves the context unusable:
	 * refuse the connection instead of starting a handshake on it. */
	rc = mbedtls_ssl_setup(*ssl, &ssl_ctx->conf);
	if (rc != 0) {
		fprintf(stderr, "SSL setup failed, error %d\n", rc);
		mbedtls_ssl_free(*ssl);
		mg_free(*ssl);
		*ssl = NULL;
		return -1;
	}
	mbedtls_ssl_set_bio(*ssl, sock, mbedtls_net_send, mbedtls_net_recv, NULL);

	/* mAT patch 3: at most request_timeout_ms for the whole handshake. */
	timeout_ms = (request_timeout_ms != NULL) ? atoi(request_timeout_ms) : 0;
	if (timeout_ms <= 0) {
		timeout_ms = MG_MAT_TLS_HANDSHAKE_DEFAULT_MS;
	}
	rc = mbed_ssl_handshake(*ssl, *sock, timeout_ms, stop_flag);
	if (rc != 0) {
		DEBUG_TRACE("TLS handshake failed (%i)", rc);
		mbedtls_ssl_free(*ssl);
		mg_free(*ssl);
		*ssl = NULL;
		return -1;
	}

	DEBUG_TRACE("TLS connection %p accepted, state: %d", ssl, (*ssl)->state);
	return 0;
}


void
mbed_ssl_close(mbedtls_ssl_context *ssl)
{
	DEBUG_TRACE("TLS connection %p closed", ssl);
	mbedtls_ssl_close_notify(ssl);
	mbedtls_ssl_free(ssl);
	mg_free(ssl); /* mg_free for mg_calloc in mbed_ssl_accept */
}


/* mAT patch 3: milliseconds on the monotonic clock. A deadline must not move
 * when the device clock is set (the BL335 has no readable RTC). */
static int64_t
mbed_ssl_now_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ((int64_t)ts.tv_sec * 1000) + (int64_t)(ts.tv_nsec / 1000000);
}


/* mAT patch 3: handshake on the non-blocking socket `sock`, at most
 * `timeout_ms` in total, ended early by a server stop. Returns 0 or an error
 * code; on an error the caller closes the connection. */
static int
mbed_ssl_handshake(mbedtls_ssl_context *ssl,
                   int sock,
                   int timeout_ms,
                   const volatile int *stop_flag)
{
	int rc;
	const int64_t deadline = mbed_ssl_now_ms() + timeout_ms;

	while ((rc = mbedtls_ssl_handshake(ssl)) != 0) {
		struct mg_pollfd pfd;
		int64_t left;
		int slice;

		if (rc != MBEDTLS_ERR_SSL_WANT_READ && rc != MBEDTLS_ERR_SSL_WANT_WRITE
		    && rc != MBEDTLS_ERR_SSL_ASYNC_IN_PROGRESS
		    && rc != MBEDTLS_ERR_SSL_CRYPTO_IN_PROGRESS) {
			/* Alert, protocol or socket error, or EOF. Early data
			 * (MBEDTLS_ERR_SSL_RECEIVED_EARLY_DATA) is never enabled, so it
			 * cannot occur. */
			break;
		}
		if (*stop_flag != 0) {
			break; /* the server is stopping: rc is still an error */
		}
		left = deadline - mbed_ssl_now_ms();
		if (left <= 0) {
			rc = MBEDTLS_ERR_SSL_TIMEOUT;
			break;
		}
		if (rc == MBEDTLS_ERR_SSL_CRYPTO_IN_PROGRESS) {
			/* Restartable ECC (MBEDTLS_ECP_RESTARTABLE, off in the mAT
			 * configuration): each call computes a further part, so call
			 * again at once. */
			continue;
		}
		if (rc == MBEDTLS_ERR_SSL_ASYNC_IN_PROGRESS) {
			/* Asynchronous private key operation (MBEDTLS_SSL_ASYNC_PRIVATE,
			 * never configured by CivetWeb): it runs elsewhere and gives no
			 * socket event to wait for, so check again a moment later. */
			mg_sleep(1);
			continue;
		}
		/* Wake at least every SOCKET_TIMEOUT_QUANTUM to see a server stop. */
		slice = (left < SOCKET_TIMEOUT_QUANTUM) ? (int)left
		                                        : SOCKET_TIMEOUT_QUANTUM;
		pfd.fd = sock;
		pfd.events = (rc == MBEDTLS_ERR_SSL_WANT_WRITE) ? POLLOUT : POLLIN;
		pfd.revents = 0;
		if ((poll(&pfd, 1, slice) < 0) && !ERROR_TRY_AGAIN(ERRNO)) {
			rc = MBEDTLS_ERR_NET_POLL_FAILED;
			break;
		}
		/* Ready, error or hang-up (the next call reports it), or the slice
		 * ran out: call mbedtls_ssl_handshake() again. */
	}

	DEBUG_TRACE("TLS handshake rc: %d, state: %d", rc, ssl->state);
	return rc;
}


int
mbed_ssl_read(mbedtls_ssl_context *ssl, unsigned char *buf, int len)
{
	int rc = mbedtls_ssl_read(ssl, buf, len);
	/* DEBUG_TRACE("mbedtls_ssl_read: %d", rc); */
	if (rc == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
		/* mAT patch 4: the client closed the connection properly
		 * (close_notify alert). Report the end of the stream as 0, like
		 * mbedtls_ssl_read() does for a TCP close without close_notify;
		 * pull_inner() closes the connection without logging an error. */
		rc = 0;
	}
	return rc;
}


int
mbed_ssl_write(mbedtls_ssl_context *ssl, const unsigned char *buf, int len)
{
	int rc = mbedtls_ssl_write(ssl, buf, len);
	/* DEBUG_TRACE("mbedtls_ssl_write: %d", rc); */
	return rc;
}


static void
mbed_debug(void *user_param,
           int level,
           const char *file,
           int line,
           const char *str)
{
	(void)level; /* Ignored. Limit is set using mbedtls_debug_set_threshold */
	(void)user_param; /* Ignored. User parameter (context) is set using
	                  mbedtls_ssl_conf_dbg */

	DEBUG_TRACE("mbedTLS DEBUG: file: [%s] line: [%d] str: [%s]",
	            file,
	            line,
	            str);
}

#endif /* USE_MBEDTLS */
