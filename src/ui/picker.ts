// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Asks the user for a file. Must start from a click. There's no file type filter, because a 3MF can
 * be saved with no extension at all. Chrome and Edge can start in the Downloads folder; Firefox can't.
 */
type OpenFilePicker = (options: { startIn: string; multiple: boolean }) => Promise<Array<{ getFile(): Promise<File> }>>;

function fromInput(input: HTMLInputElement): Promise<File[]> {
  return new Promise((resolve) => {
    const finish = () => {
      input.removeEventListener("change", finish);
      input.removeEventListener("cancel", finish);
      const files = [...(input.files ?? [])];
      input.value = "";
      resolve(files);
    };
    input.addEventListener("change", finish);
    input.addEventListener("cancel", finish);
    input.click();
  });
}

export async function pickFiles(input: HTMLInputElement): Promise<File[]> {
  const open = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (typeof open !== "function") return fromInput(input);
  try {
    const handles = await open.call(window, { startIn: "downloads", multiple: input.multiple });
    return await Promise.all(handles.map((handle) => handle.getFile()));
  } catch (error) {
    if ((error as Error).name === "AbortError") return [];
    return fromInput(input);
  }
}
