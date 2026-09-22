#!/bin/bash
unset WAYLAND_DISPLAY
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export WLR_BACKENDS=drm,libinput
export LIBSEAT_BACKEND=builtin

rm -rf /home/maplesyrup/.config/chromium/Singleton*

exec /usr/bin/cage -s -m last -- /home/maplesyrup/master_hub/run_chrome.sh
