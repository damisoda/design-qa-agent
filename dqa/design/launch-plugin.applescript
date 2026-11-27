-- Only launch the registered dqa exporter. Never run the last-used plugin or accept dialogs.
on run argv
set isAutoLaunch to (count of argv) > 0 and item 1 of argv is "auto"
if not isAutoLaunch then tell application id "com.figma.Desktop" to activate
tell application "System Events"
  if UI elements enabled is false then return "permission_required"
  if not (exists application process "Figma") then return "app_unavailable"
  tell application process "Figma"
    set selectedFileName to ""
    set designWindow to missing value
    repeat with w in windows
      if (subrole of w as text) is "AXStandardWindow" then
        set designWindow to contents of w
        set selectedFileName to name of w as text
        exit repeat
      end if
    end repeat
    if isAutoLaunch then
      if frontmost is false then return "inactive"
      if designWindow is missing value then return "inactive"
      if (count of sheets of designWindow) > 0 then return "busy"
      -- Read only the visible Figma window. Do not steal focus or close another plugin.
      if (count of argv) > 1 then
        if item 2 of argv is "probe" then return "active" & tab & selectedFileName
      end if
      if frontmost is false then return "inactive"
    else
      set frontmost to true
    end if
    repeat 20 times
      if exists menu bar 1 then exit repeat
      delay 0.2
    end repeat
    set pluginMenu to missing value
    repeat with labelText in {"플러그인", "Plugins"}
      if exists menu bar item (contents of labelText) of menu bar 1 then
        set pluginMenu to menu bar item (contents of labelText) of menu bar 1
        exit repeat
      end if
    end repeat
    if pluginMenu is missing value then return "file_required"
    if enabled of pluginMenu is false then return "file_required"
    click pluginMenu
    set developmentMenu to missing value
    repeat with labelText in {"개발", "Development"}
      if exists menu item (contents of labelText) of menu 1 of pluginMenu then
        set developmentMenu to menu item (contents of labelText) of menu 1 of pluginMenu
        exit repeat
      end if
    end repeat
    if developmentMenu is missing value then
      perform action "AXCancel" of menu 1 of pluginMenu
      return "plugin_not_found"
    end if
    if not (exists menu item "dqa 시안 내보내기" of menu 1 of developmentMenu) then
      perform action "AXCancel" of menu 1 of pluginMenu
      return "plugin_not_found"
    end if
    set exporter to menu item "dqa 시안 내보내기" of menu 1 of developmentMenu
    if enabled of exporter is false then
      perform action "AXCancel" of menu 1 of pluginMenu
      return "file_required"
    end if
    click exporter
    return "requested" & tab & selectedFileName
  end tell
end tell

end run
