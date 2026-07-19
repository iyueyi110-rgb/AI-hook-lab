# 代码审查修复指令

> 生成时间：2026-07-18 | 来源：AI Hook Lab 代码审查

---

## 执行前必读

1. **先 Read 每个要改的文件，再动手。**
2. **每完成一步跑 `npm run build` 确认零 TS 错误。**
3. **不改业务逻辑，只修类型/配置/依赖问题。**
4. **不改 CSS / tailwind / 组件 UI。**

---

## 改动范围

| 步骤 | 文件 | 操作 | 说明 |
|------|------|------|------|
| S1 | 根目录 | `npm install` | 安装缺失的 pg 和 @phosphor-icons/react |
| S2 | `tsconfig.json` | ✏️ 改一行 | target ES2017 → ES2018 |
| S3 | `lib/imageAnalysis.test.ts` | ✏️ 类型守卫 | `.status` 访问前加类型收窄 |
| S4 | `lib/persistence.test.ts` | ✏️ as const | NODE_ENV 类型断言 |
| S5 | `lib/dashboardStore.ts` | ✏️ 补类型 | L506 隐式 any |
| S6 | 多个 lib 文件 | ✏️ 去 .ts 后缀 | import 路径规范化 |

---

## S1：安装依赖

```bash
cd "d:/1/AI hook/ai-hook-lab"
npm install
```

**验证：** `ls node_modules/pg` 和 `ls node_modules/@phosphor-icons/react` 都应存在。

---

## S2：tsconfig.json — target 升级

**文件：** `tsconfig.json`

```diff
- "target": "ES2017",
+ "target": "ES2018",
```

**原因：** `visualRedesignContract.test.ts` 使用了正则 `s` (dotAll) 标志，需要 ES2018+。

---

## S3：lib/imageAnalysis.test.ts — 类型守卫

**文件：** `lib/imageAnalysis.test.ts`

`ImageValidationResult` 是联合类型：

```ts
type ImageValidationResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };
```

在 `ok: true` 分支上 `.status` 不存在，TypeScript 报错。

**改法：** 在所有访问 `.status` / `.error` / `.message` 的地方，先做类型收窄：

```ts
const result = await validateImageUpload(file);
if (!result.ok) {
  // 只有在这个分支里才能访问 .status .error .message
  expect(result.status).toBe(400);
  expect(result.error).toBe("...");
  expect(result.message).toBe("...");
}
```

**涉及行：** L43-L44, L55-L56（约 4 处断言）

---

## S4：lib/persistence.test.ts — 类型断言

**文件：** `lib/persistence.test.ts` L17-L18

`NODE_ENV` 的类型是 `"development" | "production" | "test" | undefined`，但测试传入普通 `string`，类型不兼容。

```diff
- const env = { NODE_ENV: 'production', DATABASE_URL: 'postgres://...' };
+ const env = { NODE_ENV: 'production' as const, DATABASE_URL: 'postgres://...' };
```

---

## S5：lib/dashboardStore.ts — 隐式 any

**文件：** `lib/dashboardStore.ts` L506

`.filter()` 回调中 `event` 参数缺少类型：

```diff
- return result.rows.reverse().map(parseEvent).filter((event): event is DashboardEvent => Boolean(event));
+ return result.rows.reverse().map(parseEvent).filter((event: DashboardEvent | null): event is DashboardEvent => Boolean(event));
```

---

## S6：import 路径去 .ts 后缀

以下文件的 import 路径去掉 `.ts` 扩展名。虽然 `allowImportingTsExtensions` 开启了，但非标准写法容易在工具链中出问题。

| 文件 | 改前 | 改后 |
|------|------|------|
| `lib/constants.ts` L7 | `"./constants.ts"` | `"./constants"` |
| `lib/promptTemplates.ts` L7 | `"./constants.ts"` | `"./constants"` |
| `lib/dashboardStore.ts` L4 | `"./constants.ts"` | `"./constants"` |
| `lib/dashboardStore.ts` L5 | `"./evaluation/origins.ts"` | `"./evaluation/origins"` |
| `lib/dashboardStore.ts` L6 | `"./evaluation/types.ts"` | `"./evaluation/types"` |
| `lib/dashboardStore.ts` L7 | `"./promptTemplates.ts"` | `"./promptTemplates"` |
| `lib/dashboardStore.ts` L11 | `"./persistence.ts"` | `"./persistence"` |
| `lib/adminAccess.ts` L1 | `"./evaluation/types.ts"` | `"./evaluation/types"` |
| `lib/evaluation/repository.ts` L10 | `"../persistence.ts"` | `"../persistence"` |
| `lib/evaluation/repository.ts` L11-13 | `"./seeds.ts"` `"./schema.ts"` `"./types.ts"` | `"./seeds"` `"./schema"` `"./types"` |
| `lib/evaluation/service.ts` L3-22 | 所有 `./xxx.ts` | `./xxx` |

**定位所有位置：**

```bash
grep -rn "from \".*\.ts\"" lib/ --include="*.ts"
```

然后逐个去掉 `.ts` 后缀。

---

## 验收标准

- [ ] `npm install` 成功
- [ ] `npm run build` 零 TS 错误
- [ ] `npm test` 全部通过（不再有 `ERR_MODULE_NOT_FOUND` 的 `pg` 错误）
- [ ] import 路径中不再有 `.ts` 后缀
- [ ] 不改动任何业务逻辑
- [ ] 不改 CSS / tailwind 配置 / 组件 UI
