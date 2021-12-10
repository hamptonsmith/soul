Vagrant.configure("2") do |config|
  config.vm.box = "bento/ubuntu-20.04"
  config.vm.provision "shell", inline: "wget -qO- --no-cache https://raw.githubusercontent.com/hamptonsmith/pelton/master/pelton.sh | bash"
end
