#!/bin/bash
# Wayland 화면 인식 대기
while [ ! -e "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; do
    sleep 0.1
done

exec /usr/bin/chromium-browser \
    --ozone-platform=wayland \
    --no-sandbox \
    --test-type \
    --disable-gpu \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --password-store=basic \
    --touch-events=enabled \
    --hide-scrollbars \
    --kiosk \
    http://localhost:8080/panel.html
