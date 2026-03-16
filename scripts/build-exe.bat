@echo off
setlocal

echo ================================================
echo  wa-chat-summariser -- Build Single EXE
echo ================================================
echo.

:: Step 1: Build the React frontend
echo [1/3] Building React frontend...
call npm run build
if errorlevel 1 ( echo ERROR: frontend build failed & exit /b 1 )

:: Step 2: esbuild -- bundle backend/server.js to dist/bundle.cjs
echo.
echo [2/3] Bundling Node.js code with esbuild...
call node scripts/build.js
if errorlevel 1 ( echo ERROR: esbuild bundling failed & exit /b 1 )

:: Step 3: pkg -- wrap bundle + Node.js runtime into a single .exe
echo.
echo [3/3] Packaging into dist\wa-summariser.exe ...
call npx @yao-pkg/pkg scripts/entry.cjs --targets node20-win-x64 --output dist/wa-summariser.exe
if errorlevel 1 ( echo ERROR: pkg packaging failed & exit /b 1 )

echo.
echo ================================================
echo  Build complete!
echo.
echo  Output : dist\wa-summariser.exe
echo.
echo  Also copy these alongside the .exe before distributing:
echo    - .env                  (API keys and settings)
echo    - node_modules\         (runtime dependencies)
echo.
echo  NOTE: On first run WhatsApp will download Chromium to
echo        %%LOCALAPPDATA%%\puppeteer  (done once, ~170 MB)
echo        Or set PUPPETEER_EXECUTABLE_PATH to your Chrome.
echo ================================================
endlocal
