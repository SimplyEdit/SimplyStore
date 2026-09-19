# Disposable filesystem power-loss exercise

`scripts/power-loss-vm/exercise.py` runs the actual server and storage code in a
Linux VM with an ext4 data volume (`data=ordered,barrier=1`). It creates only
regular image files beneath a new temporary workspace; it never mounts or writes
a host block device. A statically linked BusyBox, Node, Python, cpio, gzip, mkfs.ext4,
a QEMU x86 system binary/firmware, and a Linux kernel with built-in ext4 and virtio
block support are required. Installed packages are not modified by the script.

```sh
python3 scripts/power-loss-vm/exercise.py \
  --qemu /usr/bin/qemu-system-x86_64 --kernel /path/to/readable/vmlinuz \
  --firmware-dir /usr/share/qemu --bios /usr/share/seabios/bios-256k.bin
```

`--library-path` can point at libraries unpacked with QEMU into a temporary
workspace. `--work` selects a new, nonexistent output directory; otherwise the
script allocates one under `/tmp`. No host root privileges or KVM access are
required: it uses TCG emulation with two CPUs and 1024 MiB RAM. No external guest
network is attached; client/server traffic stays on guest loopback.

The host observes acknowledgment markers over the VM's serial output and kills
the entire VM, losing guest RAM and kernel caches. The test NBD device buffers
writes in memory and persists only completed FLUSH/FUA operations (it may persist
other bytes in the same page on FUA). At each cut the device also discards its
remaining dirty pages. Reboot attaches the surviving image and lets ext4 recover;
read-only engine inspection reports committed data and uncertain commands.

The device has a separate negative control: flushed A survives while unflushed B
is lost. A filesystem negative control also verifies that an ordinary unsynced
write disappears. Other scenarios cut after accepted, during an active handler,
and after observed completion. The completion scenario also records guest ext4
acceptance/completion latency for five commands. The output includes exact tool/
kernel identification, mount/cache settings, source revision/diff digest, serial
logs, block write/flush counts, images and a results report.

This tests a named Linux/filesystem/storage model, not physical power removal or
all hardware/cache implementations. It is a focused boundary exercise, not an
exhaustive randomized campaign. The device model honors flushes; devices that lie
about them are outside the guarantee. It cannot prove absence of historical loss
from a different writer/protocol. Local `npm run bench:durability` timings report
their filesystem separately; tmpfs timings are not disk performance measurements.

The model uses QEMU's documented [block device cache settings](https://www.qemu.org/docs/master/system/qemu-manpage.html).
See also QEMU's [block I/O fault testing documentation](https://www.qemu.org/docs/master/devel/testing/blkdebug.html)
for the distinction between guest writes and flush events. The test backend is
purpose-built for this bounded exercise, not a production NBD server.
