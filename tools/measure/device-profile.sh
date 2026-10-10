#!/bin/sh
# Read-only device profile (Master Plan 11.1). Prints Markdown.
echo "# Device profile"; echo; echo "Collected: $(date -u +%FT%TZ)"; echo
sec() { echo; echo "## $1"; echo '```'; }
end() { echo '```'; }
sec uname;      uname -a; getconf LONG_BIT; end
sec os;         grep -E '^(PRETTY_NAME|VERSION)=' /etc/os-release; ldd --version 2>&1 | head -1; end
sec cpu;        grep -E 'model name|Hardware|Features|CPU (implementer|part)' /proc/cpuinfo | sort -u; echo "nproc=$(nproc)"; end
sec memory;     free -m; end
sec storage;    df -h; mount | grep -E ' / |mmc'; end
sec emmc;       ls /sys/class/mmc_host/*/ 2>&1 | head -5; which mmc 2>&1; end
sec serial;     ls /dev/ttyAS* /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null; end
sec rtc;        ls /dev/rtc* 2>&1; hwclock -r 2>&1; timedatectl 2>&1 | head -6; end
sec thermal;    cat /sys/class/thermal/thermal_zone*/temp 2>&1; end
sec network;    ip -br a; end
sec services;   systemctl list-units --type=service --state=running --no-pager 2>&1 | head -30; end
sec tools;      for t in gcc g++ cmake python3 mmc; do printf '%s: ' $t; which $t || echo none; done; end
sec libs;       ls /lib/arm-linux-gnueabihf 2>/dev/null | grep -E 'libstdc|libssl|libz\.|libsqlite'; end
