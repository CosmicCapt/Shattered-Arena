@echo off
rem Compile the 3x Unstable Rift effects (maps\hl_arena_pit\particles\rift_*.vpcf in the arena_pit addon)
rem with Modlock Tools. They live in the map's own folder because modlock publish lets the map's .vpk hold
rem only the map's own files. The sources are made by tools\rift\make_rift_vpcf.py (Claude runs it); the compiled
rem files come out in modlock-tools\game\citadel_addons\arena_pit\maps\hl_arena_pit\particles\.
rem Claude then packs them into maps\hl_arena_pit.vpk, which ships them with the map.
setlocal

set "SDK=%USERPROFILE%\modlock-tools"
set "ADDON=arena_pit"
set "SRC=%SDK%\content\citadel_addons\%ADDON%\maps\hl_arena_pit\particles"
set "OUT=%SDK%\game\citadel_addons\%ADDON%\maps\hl_arena_pit\particles"

if not exist "%SRC%\rift_portal_model.vpcf" (
  echo Can't find the rift sources in %SRC%
  goto :fail
)
if not exist "%SDK%\game\bin\win64\resourcecompiler.exe" (
  echo Can't find Modlock Tools at %SDK%
  goto :fail
)

pushd "%SDK%\game\bin\win64"
for %%F in ("%SRC%\rift_*.vpcf") do (
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
echo Done. Tell Claude, who packs them into the map.
pause
exit /b 0

:fail
echo.
echo Stopped.
pause
exit /b 1
