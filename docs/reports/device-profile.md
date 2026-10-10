# Device profile

Collected: 2026-10-10T03:34:58Z


## uname
```
Linux BL335-bliiot 5.4.61 #70 SMP PREEMPT Thu Apr 30 17:03:10 CST 2026 armv7l armv7l armv7l GNU/Linux
32
```

## os
```
VERSION="20.04.5 LTS (Focal Fossa)"
PRETTY_NAME="Ubuntu 20.04.5 LTS"
ldd (Ubuntu GLIBC 2.31-0ubuntu9.9) 2.31
```

## cpu
```
CPU implementer	: 0x41
CPU part	: 0xc07
Features	: half thumb fastmult vfp edsp neon vfpv3 tls vfpv4 idiva idivt vfpd32 lpae 
Hardware	: Generic DT based system
model name	: ARMv7 Processor rev 5 (v7l)
nproc=2
```

## memory
```
              total        used        free      shared  buff/cache   available
Mem:            993          66         838           0          88         902
Swap:             0           0           0
```

## storage
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/root       6.8G  719M  6.1G  11% /
devtmpfs        485M     0  485M   0% /dev
tmpfs           497M     0  497M   0% /dev/shm
tmpfs           100M  808K   99M   1% /run
tmpfs           5.0M     0  5.0M   0% /run/lock
tmpfs           497M     0  497M   0% /sys/fs/cgroup
tmpfs           100M     0  100M   0% /run/user/0
/dev/mmcblk0p5 on / type ext4 (rw,relatime)
```

## emmc
```
/sys/class/mmc_host/mmc0/:
device
mmc0:0001
power
subsystem
```

## serial
```
/dev/ttyAS0
/dev/ttyAS2
/dev/ttyAS3
/dev/ttyAS4
/dev/ttyAS5
/dev/ttyS0
/dev/ttyS1
/dev/ttyS2
/dev/ttyS3
/dev/ttyUSB0
/dev/ttyUSB1
/dev/ttyUSB2
/dev/ttyUSB3
```

## rtc
```
/dev/rtc
/dev/rtc0
hwclock: select() to /dev/rtc0 to wait for clock tick timed out
               Local time: Sat 2026-10-10 10:35:09 +07  
           Universal time: Sat 2026-10-10 03:35:09 UTC  
                 RTC time: Sat 2026-10-10 03:35:09      
                Time zone: Asia/Ho_Chi_Minh (+07, +0700)
System clock synchronized: yes                          
              NTP service: active                       
```

## thermal
```
31691
```

## network
```
lo               UNKNOWN        127.0.0.1/8 ::1/128 
can0             DOWN           
eth1             UP             192.168.1.110/24 fe80::c0d9:ccff:fe52:3370/64 
eth2             DOWN           fe80::2e0:9aff:fe4d:ad50/64 
sit0@NONE        DOWN           
ip6tnl0@NONE     DOWN           
usb0             UP             192.168.225.25/24 fe80::ece5:adff:fe55:174e/64 
```

## services
```
  UNIT                        LOAD   ACTIVE SUB     DESCRIPTION                           
  dbus.service                loaded active running D-Bus System Message Bus              
  getty@tty1.service          loaded active running Getty on tty1                         
  networkd-dispatcher.service loaded active running Dispatcher daemon for systemd-networkd
  rc-local.service            loaded active running /etc/rc.local Compatibility           
  serial-getty@ttyAS0.service loaded active running Serial Getty on ttyAS0                
  ssh.service                 loaded active running OpenBSD Secure Shell server           
  systemd-journald.service    loaded active running Journal Service                       
  systemd-logind.service      loaded active running Login Service                         
  systemd-networkd.service    loaded active running Network Service                       
  systemd-resolved.service    loaded active running Network Name Resolution               
  systemd-timedated.service   loaded active running Time & Date Service                   
  systemd-timesyncd.service   loaded active running Network Time Synchronization          
  systemd-udevd.service       loaded active running udev Kernel Device Manager            
  user@0.service              loaded active running User Manager for UID 0                
  wpa_supplicant.service      loaded active running WPA supplicant                        

LOAD   = Reflects whether the unit definition was properly loaded.
ACTIVE = The high-level unit activation state, i.e. generalization of SUB.
SUB    = The low-level unit activation state, values depend on unit type.

15 loaded units listed.
```

## tools
```
gcc: none
g++: none
cmake: none
python3: /usr/bin/python3
mmc: none
```

## libs
```
libsqlite3.so.0
libsqlite3.so.0.8.6
libssl.so.1.1
libstdc++.so.6
libstdc++.so.6.0.28
libz.so.1
libz.so.1.2.11
```
