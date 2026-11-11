#!/bin/sh
set -eu
ssh-keygen -A
install -m 700 -o splice -g splice -d /home/splice/.ssh
install -m 600 -o splice -g splice /fixture-key.pub /home/splice/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e -f /etc/ssh/splice_sshd_config
