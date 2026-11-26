# any2u1

## 0.1.1

The first version on Firefox Add-ons. Converted files are the same as 0.1.0's.

### Fixes

- **Settings,** at the foot of the convert page and the small window, is in the accent color like the pages' links, so it's easier to find.

## 0.1.0

The first release. any2u1 is a browser extension that turns a 3MF project from any site into a Snapmaker U1 file, on your own device. It reads projects saved by Bambu Studio, Creality Print, Anycubic Slicer Next, ElegooSlicer, Flash Studio, PrusaSlicer and QIDI Studio. Nothing is uploaded.

### Features

- **An offer when a 3MF finishes downloading.** A small window asks whether to convert it. **Convert for Snapmaker U1** fetches the file again if the site's server allows it; if not, you choose between allowing access to that one host and picking the copy you saved. For a file the site built in the page, **Show where it was saved** opens the folder the browser put it in.
- **The converted file** is saved next to your other downloads as `<name>_U1.3mf`, with the profile and nozzle size it's made for, any notes worth reading, grouped by topic with what needs doing first, and **Show in folder**. Turn on **Ask where to save each converted file** to name each file and choose its folder.
- **While it converts,** the page shows the step it's on, a clock and a moving bar, and **Stop** ends a conversion that's taking too long. **Clear** empties the list of results; the files stay in your downloads.
- **The convert page,** from the toolbar button, takes a 3MF, or a zip holding 3MF files, at any time.
- **A first-run tab** after install says what happens on the next 3MF download and how to pin the button, in the words of the browser's own extensions menu, and whether it's pinned already.
- **Options:**
  - **Snapmaker Orca version:** the version the file is made for. The newest is the default, a notice says when an update adds one, and every version from 2.4.0 on stays in the picker.
  - **Your U1's nozzle size:** the size the file is made for, 0.4 mm unless you change it, or **Match the file** for the creator's size. A project made for another size is converted anyway, with a note. A filament tuned for another nozzle size takes the calibration of Snapmaker's U1 preset for its material, and a filament of another diameter takes a preset Snapmaker Orca ships, where one fits; the result says so first.
  - **Layer height:** keep the creator's layers, or convert with one layer height for every layer, from the heights the U1's profiles have for your nozzle size. When a project has layers outside the range those profiles use, the result says so.
  - **High-flow toolheads,** for each toolhead fitted with the Liber High Flow Hotend.
  - **My nozzles are hardened steel,** so Snapmaker Orca warns about abrasive filaments correctly.
  - **Filament:** Original keeps the creator's filaments exactly, names and settings. Snapmaker, Polymaker and Generic switch each filament to a preset Snapmaker Orca ships, with that preset's own settings, for uploads to Snapmaker Space; colors and order stay. Polymaker switches each PLA to a Polymaker preset, for the 0.4 mm nozzle.
- **Offers your way:** a small window, or only a number on the toolbar button. Turn offers off, or off for one site with **Not on**.
- **Settings** lists the hosts you gave access to, with **Remove**, and **Copy the versions** copies the browser, extension and library versions for a bug report, naming no file, site or address. **Report a problem**, beside it and beside a failed file's **Copy a report**, opens the bug report form on GitHub.
- **Permissions:** downloads and storage, plus access to one host only when you allow it. It never runs in private windows.

### Converted files

- Converts with any2orca 0.18.2 and any2orca-profiles 0.6.0.
