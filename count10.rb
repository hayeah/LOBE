i = 0
loop do
  exit(0) if i > 3
  puts i
  $stdout.flush
  sleep(0.5)
  i += 1
end
