#!/bin/sh
# Usage: sample.sh <scenario> <seconds> [pid]   -> CSV on stdout: t,rssMb,memAvailMb,cpuPct
# cpuPct = system-wide busy % (all cores) per 1 s interval; rssMb only if pid given.
scenario=$1; secs=${2:-60}; pid=$3
echo "# scenario=$scenario start=$(date -u +%FT%TZ)"
echo "t,rssMb,memAvailMb,cpuPct"
read_cpu() { awk '/^cpu /{idle=$5+$6; tot=0; for(i=2;i<=NF;i++) tot+=$i; print tot, idle}' /proc/stat; }
set -- $(read_cpu); pt=$1; pi=$2
t=0
while [ $t -lt $secs ]; do
  sleep 1; t=$((t+1))
  set -- $(read_cpu); ct=$1; ci=$2
  dt=$((ct-pt)); di=$((ci-pi)); pt=$ct; pi=$ci
  cpu=$(awk -v dt=$dt -v di=$di 'BEGIN{ if(dt>0) printf "%.1f",(dt-di)*100/dt; else print 0 }')
  avail=$(awk '/MemAvailable/{printf "%.1f",$2/1024}' /proc/meminfo)
  rss=""; [ -n "$pid" ] && rss=$(awk '/VmRSS/{printf "%.1f",$2/1024}' /proc/$pid/status 2>/dev/null)
  echo "$t,$rss,$avail,$cpu"
done
