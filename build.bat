@echo off
echo Building Antigravity Auto Retry extension...

cd extension
if %errorlevel% neq 0 (
    echo [ERROR] Failed to navigate to the extension directory.
    pause
    exit /b %errorlevel%
)

echo.
echo Copying LICENSE and README from root...
copy /Y ..\LICENSE .\LICENSE >nul
copy /Y ..\README.md .\README.md >nul

echo.
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b %errorlevel%
)

echo.
echo Compiling TypeScript...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b %errorlevel%
)

echo.
echo Packaging to .vsix...
call npm run package
if %errorlevel% neq 0 (
    echo [ERROR] Packaging failed.
    pause
    exit /b %errorlevel%
)

echo.
echo [SUCCESS] Extension compiled and packaged successfully!
echo The .vsix file has been generated in the root directory.
pause
