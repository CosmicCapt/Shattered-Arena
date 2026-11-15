@echo off
rem Compile the Arena Pit map with Modlock Tools as map "hl_arena_pit", then copy it into the project's
rem maps folder (modlock publish uploads it from there) and into Deadlock (for modlock dev).
rem The map source lives in Modlock Tools: content\citadel_addons\arena_pit\maps\hl_arena_pit.vmap
rem (open it with Hammer_arena.cmd in the modlock-tools folder; Hammer's copy is the master once you edit it).
rem Lighting is not baked: the sun is a dynamic light, and a bake adds about 42 MB of lightmaps to the map.
rem To bake again, add -bakedlighting -bakelighting to both resourcecompiler lines.
setlocal

set "SDK=%USERPROFILE%\modlock-tools"
set "MAP=hl_arena_pit"
set "ADDON=arena_pit"
set "DEADLOCK_MAPS=A:\SteamLibrary\steamapps\common\Deadlock\game\citadel\maps"
set "PROJECT_MAPS=%~dp0..\maps"

set "IN=%SDK%\content\citadel_addons\%ADDON%\maps\%MAP%.vmap"
set "OUT=%SDK%\game\citadel_addons\%ADDON%\maps\%MAP%.vpk"

if not exist "%IN%" (
  echo Can't find the map source: %IN%
  goto :fail
)
if not exist "%SDK%\game\bin\win64\resourcecompiler.exe" (
  echo Can't find Modlock Tools at %SDK%
  goto :fail
)
if exist "%OUT%" del "%OUT%"

echo [1/2] Compiling %MAP% (save it in Hammer first if you changed it)
pushd "%SDK%\game\bin\win64"
resourcecompiler.exe -game "%SDK%\game\citadel" -i "%IN%" -nop4 -fshallow -world -phys -vis -nav
if not exist "%OUT%" (
  echo.
  echo The compile with a navigation mesh ^(-nav^) made no map. Trying again without it...
  resourcecompiler.exe -game "%SDK%\game\citadel" -i "%IN%" -nop4 -fshallow -world -phys -vis
)
popd
if not exist "%OUT%" (
  echo No compiled map at %OUT%. Copy the compiler output above and send it to Claude.
  goto :fail
)

echo [2/2] Copying %MAP%.vpk into the project and into Deadlock
if not exist "%PROJECT_MAPS%" mkdir "%PROJECT_MAPS%"
copy /y "%OUT%" "%PROJECT_MAPS%\%MAP%.vpk" >nul || goto :fail
copy /y "%OUT%" "%DEADLOCK_MAPS%\%MAP%.vpk" >nul || goto :fail
echo.
echo Done: %PROJECT_MAPS%\%MAP%.vpk and %DEADLOCK_MAPS%\%MAP%.vpk
echo Now fully restart modlock dev in the arena-pit project folder. ^(The Rift effects ship in content\, so
echo nothing needs packing into the map.^)
pause
exit /b 0

:fail
echo.
echo Stopped.
pause
exit /b 1
