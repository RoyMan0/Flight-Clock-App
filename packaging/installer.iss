; Inno Setup script for the Windows installer. Built by packaging\build-win.ps1, which passes
; AppVersion, SourceDir (dist\Flight Clock), OutputDir and IconFile with /D.
;
; Installs per user (no admin prompt) into %LOCALAPPDATA%\Programs\Flight Clock. Settings
; and data live in %APPDATA%\Flight Clock and are kept on uninstall.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8F3C2A51-6B7E-4D2A-9C1F-FC0C1A0C1001}
AppName=Flight Clock
AppVersion={#AppVersion}
AppVerName=Flight Clock {#AppVersion}
AppPublisher=Flight Clock
DefaultDirName={autopf}\Flight Clock
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutputDir}
OutputBaseFilename=FlightClock-Setup-{#AppVersion}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Flight Clock.exe
UninstallDisplayName=Flight Clock
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; A new version replaces the old app folder completely (no stale modules)
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\Flight Clock"; Filename: "{app}\Flight Clock.exe"
Name: "{autodesktop}\Flight Clock"; Filename: "{app}\Flight Clock.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Flight Clock.exe"; Description: "{cm:LaunchProgram,Flight Clock}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM ""Flight Clock.exe"" /F"; Flags: runhidden; RunOnceId: "StopApp"

[Registry]
; "Open at login" (Settings → Windows App) writes this; remove it with the app
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Flight Clock"; Flags: uninsdeletevalue dontcreatekey

[Code]
const
  WebView2Key = '\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView2: Boolean;
var
  v: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node' + WebView2Key, 'pv', v)
         or RegQueryStringValue(HKLM, 'SOFTWARE' + WebView2Key, 'pv', v)
         or RegQueryStringValue(HKCU, 'Software' + WebView2Key, 'pv', v);
  Result := Result and (v <> '') and (v <> '0.0.0.0');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  code: Integer;
begin
  if (CurStep = ssPostInstall) and not HasWebView2 then
    if MsgBox('Flight Clock needs the Microsoft Edge WebView2 Runtime, which isn''t installed on this PC.' + #13#10#13#10 +
              'Open the download page now?', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://go.microsoft.com/fwlink/p/?LinkId=2124703', '', '', SW_SHOWNORMAL, ewNoWait, code);
end;
