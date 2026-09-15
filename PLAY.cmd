@echo off
setlocal
rem CLEARED TO LAND launcher: opens the single-file game in an app-style browser window.
set "HTML=%~dp0CTL.html"
if not exist "%HTML%" (
  echo CTL.html not found next to this launcher. Run "npm run build" first.
  pause
  exit /b 1
)
set "BROWSER="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) do (
  if not defined BROWSER if exist %%P set "BROWSER=%%~P"
)
set "URL=%HTML:\=/%"
if defined BROWSER (
  start "" "%BROWSER%" --app="file:///%URL%" --start-maximized --autoplay-policy=no-user-gesture-required
) else (
  start "" "%HTML%"
)
endlocal
