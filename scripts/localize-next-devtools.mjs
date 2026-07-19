import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(
  projectRoot,
  "node_modules",
  "next",
  "dist",
  "compiled",
  "next-devtools",
  "index.js",
);

const translations = [
  ['label:"Issues"', 'label:"问题"'],
  ['label:"Route"', 'label:"路由"'],
  ['label:"Bundler"', 'label:"构建工具"'],
  ['label:"Route Info"', 'label:"路由信息"'],
  ['label:"Preferences"', 'label:"偏好设置"'],
  ['value:"static"===h.staticIndicator?"Static":"Dynamic"', 'value:"static"===h.staticIndicator?"静态":"动态"'],
  ['children:["Issue",v>1&&', 'children:["问题",v>1&&'],
  ['children:"Theme"', 'children:"主题"'],
  ['children:"Select your theme preference."', 'children:"选择开发工具的显示主题。"'],
  ['children:"System"', 'children:"跟随系统"'],
  ['children:"Light"', 'children:"浅色"'],
  ['children:"Dark"', 'children:"深色"'],
  ['children:"Position"', 'children:"位置"'],
  ['children:"Adjust the placement of your dev tools."', 'children:"调整开发工具在页面中的位置。"'],
  ['children:"Bottom Left"', 'children:"左下角"'],
  ['children:"Bottom Right"', 'children:"右下角"'],
  ['children:"Top Left"', 'children:"左上角"'],
  ['children:"Top Right"', 'children:"右上角"'],
  ['children:"Size"', 'children:"尺寸"'],
  ['children:"Adjust the size of your dev tools."', 'children:"调整开发工具的显示尺寸。"'],
  ['let A={Small:16/14,Medium:1,Large:16/18}', 'let A={小:16/14,中:1,大:16/18}'],
  ['scale:A.Medium', 'scale:A.中'],
  ['children:"Hide Dev Tools for this session"', 'children:"在本次会话中隐藏开发工具"'],
  ['children:"Hide Dev Tools until you restart your dev server, or 1 day."', 'children:"隐藏至开发服务器重启，最长 1 天。"'],
  ['children:"Hide"', 'children:"隐藏"'],
  ['children:"Hide Dev Tools shortcut"', 'children:"隐藏开发工具快捷键"'],
  ['children:"Set a custom keyboard shortcut to toggle visibility."', 'children:"设置用于显示或隐藏开发工具的快捷键。"'],
  [':"Record Shortcut"', ':"录制快捷键"'],
  ['children:"Disable Dev Tools for this project"', 'children:"为此项目禁用开发工具"'],
  ['children:["To disable this UI completely, set"," ",L," in your "', 'children:["如需完全禁用此界面，请在 ",L," 中设置于 "'],
  [',children:"next.config"})," file."]', ',children:"next.config"})," 文件。"]'],
];

let source;
try {
  source = await readFile(bundlePath, "utf8");
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error("未找到 Next.js 开发工具，请先安装项目依赖。");
    process.exitCode = 1;
  } else {
    throw error;
  }
}

if (source) {
  let changed = false;
  const missing = [];

  for (const [english, chinese] of translations) {
    if (source.includes(chinese)) continue;
    if (!source.includes(english)) {
      missing.push(english);
      continue;
    }
    source = source.replaceAll(english, chinese);
    changed = true;
  }

  if (missing.length > 0) {
    console.warn(`Next.js 版本可能已变化，${missing.length} 处开发工具文案未能自动汉化。`);
  }

  if (changed) {
    await writeFile(bundlePath, source, "utf8");
    console.log("Next.js 开发工具已切换为中文。");
  } else {
    console.log("Next.js 开发工具已经是中文。");
  }
}
