set -e
OLD=/old/x64/bin/historian_tool
NEW=/build/x64/bin/historian_tool
D=/tmp/compat
rm -rf $D
COLS=T0001:FLOAT64,T0002:FLOAT64,T0003:FLOAT64,T0004:FLOAT64
echo "== old 003 tool: fill (schema 1)"
$OLD fill --data-dir $D --group bench --table bench --columns $COLS --retention 3650 --days 2 --period 60000
echo "== old count"; $OLD count --data-dir $D --table bench
echo "== new tool: backfill (upgrade 1 to 2, aggregates built)"
$NEW backfill --data-dir $D --table bench --tags 4 --timeout-s 300
echo "== new count"; $NEW count --data-dir $D --table bench
echo "== old tool opens the schema 2 file: count, integrity, append 100 rows"
$OLD count --data-dir $D --table bench
$OLD integrity --data-dir $D
$OLD fill --data-dir $D --group bench --table bench --columns $COLS --retention 3650 --rows 100 --period 60000 --start-ms 1893456000000
$OLD count --data-dir $D --table bench
$OLD integrity --data-dir $D
echo "== new count after old appended"; $NEW count --data-dir $D --table bench
cp $D/history.db /out/history-compat.db
