import { StateField } from '@codemirror/state';
export const editorInfoField = StateField.define({ create: () => ({ file: window.testFile }), update: value => value });
export class Plugin {
  cleanups = [];
  loadData = async () => ({});
  register(fn) { this.cleanups.push(fn); }
  registerEditorExtension(ext) { this.extensions = ext; }
  registerEvent() {}
  addCommand() {}
  addSettingTab() {}
}
export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
export class PluginSettingTab {}
export class Modal {}
export class MarkdownView {}
export class Setting {}
export class Notice {}
export const Platform = { isMobile: false };
export const setIcon = () => {};
export const getFrontMatterInfo = () => ({ exists: false });
