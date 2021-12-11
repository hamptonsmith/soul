Vagrant.configure("2") do |config|
    config.vm.box = "bento/ubuntu-20.04"

    config.vm.synced_folder "./vagrant/bin/", "/host/bin",
            mount_options: ["dmode=775,fmode=777"]

    # Get /host/bin on the PATH in all contexts.
    config.vm.provision "shell", inline: <<-'SCRIPT'
        function ensurePresent() {
            if ! grep "$1" "$2"; then
                echo "$1" >> "$2"
            fi
        }

        GET_ENV="set -a; source /vagrant/vagrant/env; set +a"

        ensurePresent 'BASH_ENV="~/.profile"' /etc/environment
        ensurePresent "$GET_ENV" /home/vagrant/.profile
        ensurePresent "$GET_ENV" /root/.profile
    SCRIPT

    config.vm.provision "shell", inline: <<-'SCRIPT'
        echo FOO=$FOO
    SCRIPT

    config.vm.provision "shell", inline: "wget -qO- --no-cache https://raw.githubusercontent.com/hamptonsmith/pelton/master/pelton.sh | bash"
end
