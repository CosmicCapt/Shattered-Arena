@echo off
rem Compile the 3x Unstable Rift effects that the portals play, and put them in the project's content\particles\.
rem The sources are tools\rift\src\rift_*.vpcf (made by tools\rift\make_rift_vpcf.py from the game's own
rem koth_aura pieces). This script copies them into the arena_pit addon in Modlock Tools, compiles them with
rem resourcecompiler, and copies the compiled .vpcf_c files into content\particles\, which modlock build ships
rem to every player as the mod's own addon (the mod plays them as particles/{addon}/rift_*.vpcf).
rem After this, fully restart modlock dev. No map recompile or packing is needed.
setlocal

set "SDK=%USERPROFILE%\modlock-tools"
set "ADDON=arena_pit"
set "SRC=%~dp0rift\src"
set "STAGE=%SDK%\content\citadel_addons\%ADDON%\particles\arena_pit_rift"
set "OUT=%SDK%\game\citadel_addons\%ADDON%\particles\arena_pit_rift"
set "DEST=%~dp0..\content\particles"

if not exist "%SRC%\rift_portal_model.vpcf" (
  echo Can't find the rift sources in %SRC%
  goto :fail
)
if not exist "%SDK%\game\bin\win64\resourcecompiler.exe" (
  echo Can't find Modlock Tools at %SDK%
  goto :fail
)

echo [1/3] Copying the sources into the %ADDON% addon
if not exist "%STAGE%" mkdir "%STAGE%"
copy /y "%SRC%\rift_*.vpcf" "%STAGE%\" >nul || goto :fail

echo [2/3] Compiling
pushd "%SDK%\game\bin\win64"
for %%F in ("%STAGE%\rift_*.vpcf") do (
  echo.
  echo ===== %%~nxF
  resourcecompiler.exe -game "%SDK%\game\citadel" -i "%%F" -nop4 -f
)
popd

echo.
set MISSING=0
for %%N in (portal_model outline outline_edge sparks dimension decal_edge light) do (
  if exist "%OUT%\rift_%%N.vpcf_c" (echo ok      rift_%%N.vpcf_c) else (echo MISSING rift_%%N.vpcf_c & set MISSING=1)
)
if "%MISSING%"=="1" (
  echo.
  echo Some effects didn't compile. Copy the output above and send it to Claude.
  goto :fail
)

echo.
echo [3/3] Copying the compiled effects into content\particles
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%OUT%\rift_*.vpcf_c" "%DEST%\" >nul || goto :fail
echo.
echo Done: %DEST%\rift_*.vpcf_c
echo Now fully restart modlock dev in the arena-pit project folder.
pause
exit /b 0

:fail
echo.
echo Stopped.
pause
exit /b 1
