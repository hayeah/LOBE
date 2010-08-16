i = 0
loop do
  puts "pid(#{Process.pid}) #{i}"
  $stdout.flush
  sleep(1)
  i += 1
end
