# any2u1

## 0.1.0

The first release. any2u1 is a browser extension that turns a 3MF project from any site into a Snapmaker U1 file, on your own device. It reads projects saved by Bambu Studio, Creality Print, Anycubic Slicer Next, ElegooSlicer, Flash Studio, PrusaSlicer and QIDI Studio. Nothing is uploaded.

### Features

- **An offer when a 3MF finishes downloading.** A small window asks whether to convert it. **Convert for Snapmaker U1** fetches the file again if the site's server allows it; if not, you choose between allowing access to that one host and picking the copy you saved. For a file the site built in the page, **Show where it was saved** opens the folder the browser put it in.
- **The converted file** is saved next to your other downloads as `<name>_U1.3mf`, with any notes worth reading and **Show in folder**. Turn on **Ask where to save each converted file** to name each file and choose its folder.
- **While it converts,** the page shows the step it's on, a clock and a moving bar, and **Stop** ends a conversion that's taking too long. **Clear** empties the list of results; the files stay in your downloads.
- **The convert page,** from the toolbar button, takes a 3MF, or a zip holding 3MF files, at any time.
- **Options:**
  - **Snapmaker Orca version:** the version the file is made for. The newest is the default, a notice says when an update adds one, and every version from 2.4.0 on stays in the picker.
  - **High-flow toolheads,** for each toolhead fitted with the Liber High Flow Hotend.
  - **My nozzles are hardened steel,** so Snapmaker Orca warns about abrasive filaments correctly.
  - **Filament:** Original keeps the creator's filaments exactly, names and settings. Generic and Snapmaker switch each filament to a preset Snapmaker Orca ships, with that preset's own settings, for uploads to Snapmaker Space; colors and order stay.
- **Offers your way:** a small window, or only a number on the toolbar button. Turn offers off, or off for one site with **Not on**.
- **Settings** lists the hosts you gave access to, with **Remove**, and **Copy the versions** copies the browser, extension and library versions for a bug report, naming no file, site or address.
- **Permissions:** downloads and storage, plus access to one host only when you allow it. It never runs in private windows.

### Converted files

- Converts with any2orca 0.10.0 and any2orca-profiles 0.4.0.
