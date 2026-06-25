$logFile = "C:\Users\aaaaa\Desktop\chama_system\tunnel.log"
start-process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd localtunnel --port 3000 --subdomain apwoche-6922 > $logFile 2>&1" -WindowStyle Hidden
Write-Output "Started tunnel for apwoche-6922"
