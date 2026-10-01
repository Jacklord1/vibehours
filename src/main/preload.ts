import { contextBridge, ipcRenderer } from "electron";

// The only things the page can ask the shell to do.
contextBridge.exposeInMainWorld("vibehours", {
  state: () => ipcRenderer.invoke("vibehours:state"),
  lookAgain: () => ipcRenderer.invoke("vibehours:look-again"),
  refresh: () => ipcRenderer.invoke("vibehours:refresh"),
  report: () => ipcRenderer.invoke("vibehours:report"),
  addSource: (source: unknown) => ipcRenderer.invoke("vibehours:add-source", source),
  removeSource: (source: unknown) => ipcRenderer.invoke("vibehours:remove-source", source),
  readSource: (source: unknown) => ipcRenderer.invoke("vibehours:read-source", source),
  setZone: (zone: string) => ipcRenderer.invoke("vibehours:set-zone", zone),
  setPlanPrice: (text: string) => ipcRenderer.invoke("vibehours:set-plan-price", text),
  setHideNames: (hide: boolean) => ipcRenderer.invoke("vibehours:set-hide-names", hide),
  closeWeekLine: () => ipcRenderer.invoke("vibehours:close-week-line"),
  openCostSource: () => ipcRenderer.invoke("vibehours:open-cost-source"),
  savePicture: (png: Uint8Array, name: string) => ipcRenderer.invoke("vibehours:save-picture", png, name),
  copyPicture: (png: Uint8Array) => ipcRenderer.invoke("vibehours:copy-picture", png),
  finishFirstRun: () => ipcRenderer.invoke("vibehours:finish-first-run"),
  answerKeepYear: (yes: boolean) => ipcRenderer.invoke("vibehours:answer-keep-year", yes),
  // Called with the numbers each time a source starts, moves on or lands.
  onChanged: (show: (result: unknown) => void) => {
    ipcRenderer.on("vibehours:changed", (_event, result: unknown) => show(result));
  },
});
