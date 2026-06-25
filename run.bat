@echo off
cd /d C:\Users\aaaaa\Desktop\chama_system
start /B node server.js
timeout /t 3 /nobreak > nul
npx.cmd localtunnel --port 3000 --subdomain apwoche-app
