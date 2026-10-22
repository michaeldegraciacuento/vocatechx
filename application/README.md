# application

Installers for the VocaTechX Software Center. Everything in this folder except
this file is ignored by Git, so large installers never reach GitHub.

## Adding an app

1. Download the installer (`.exe` or `.msi`) from the publisher's official site.
   Prefer the full/offline installer, not a small web installer that downloads
   more files while it runs.
2. Copy it into this folder (loose, or in a folder of its own).
3. In VocaTechX, open **Software Center**. The installer appears under
   **New installers found** within a few seconds. Click **Set up**, check the
   details, and save.

Setting up writes an `app.json` next to the installer, for example:

```
application/
  vlc-media-player/
    vlc-3.0.24-win64.msi
    app.json
```

`app.json` records the installer's SHA-256 checksum. If the installer is later
replaced or damaged, VocaTechX refuses to run it until you set it up again.

## Icons

VocaTechX finds each app's icon by itself: from the installed program if the
app is installed, otherwise from the installer. It saves it as `.icon.png` in
the app's folder. To use your own, put a PNG named `icon.png` (256×256 works
best) in the app's folder; it always takes priority.

## Portable USB

Copy this folder next to `VocaTechX.exe` on the USB drive. VocaTechX looks for
`application` beside its own exe, whatever drive letter Windows assigns.

## Licences

Only copy installers you are allowed to redistribute and install on customers'
computers. Some free apps are free for personal use only.
