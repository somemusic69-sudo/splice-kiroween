FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssh-server tmux +    && rm -rf /var/lib/apt/lists/* +    && useradd -m -s /bin/bash splice +    && passwd -d splice +    && mkdir -p /run/sshd /home/splice/.ssh +    && rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub

COPY sshd_config /etc/ssh/splice_sshd_config
COPY entrypoint.sh /usr/local/bin/splice-entrypoint
ENTRYPOINT ["sh", "/usr/local/bin/splice-entrypoint"]
