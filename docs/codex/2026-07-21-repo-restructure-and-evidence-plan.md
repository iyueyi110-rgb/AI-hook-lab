# AI Hook Lab · 仓库结构重梳理与证据闭环执行计划（给 Codex）

> 制定日期：2026-07-21 ｜ 制定视角：AI 产品经理（郭恒畅本人定义目标、口径与验收，Codex 负责执行）
> 依据：《郭恒畅新版简历诊断报告-20260721》对 AI Hook 项目的意见 + 当前仓库实际状态核查
> 目标读者：Codex（执行）；二次读者：投递简历后点进仓库的招聘方

---

## 0. 背景与本计划的定位

诊断报告对 AI Hook 的核心意见（P0-1 证据没对上、P0-2 规模与周期存疑、P0-3 Demo 需验活、P1 描述过密、P2 SQL 无证据）中，**证据类工作大部分已经落地**：仓库已有 `docs/evidence/`（证据索引、简历主张审计、证据指标字典、机器可读 manifest）、`docs/portfolio/`（AI 协作边界、Demo 验证记录）、README「招聘方 30 秒入口」，以及 `npm run evidence:verify` 校验脚本。

因此本计划**不重复已完成的工作**，而是解决两类真正剩余的问题：

1. **仓库结构没有收口**：根目录和 docs 存在重复、临时和内部协作文件，招聘方 30 秒扫描时看到的是"没整理干净"的信号；一次已开始的清理（`codex/cleanup-project` 分支）尚未合并核对。
2. **证据闭环仍是"缺失/待决"状态**：受控测试与离线提升值目前标记为 `not_verified`。需要产品负责人做一次明确决策——要么补齐脱敏原始数据把数字变成 `verified`，要么正式采用保守表述，二者不能悬空。

**分工总原则**（对应诊断报告 P0-2 的"贡献边界表"）：本人负责目标、指标口径、升级门槛与验收判断；Codex 负责文件移动、脚本、文档骨架与代码重构；任何数字的分子/分母/来源由本人核对，Codex 不得反向编造原始数据。

---

## 1. 当前仓库问题清单（核查结论）

| 编号 | 问题 | 证据 | 招聘方视角影响 |
| --- | --- | --- | --- |
| S1 | 根目录有 `PRD.md` / `DESIGN.md` / `PRODUCT.md` / `deep-research-report.md`，与 `docs/prd/`、`docs/product/` 内容重叠 | 根目录直接可见 | 根目录杂乱，分不清哪个是权威版本 |
| S2 | 两份指标字典：`docs/product/metrics-dictionary.md` 与 `docs/evidence/metrics-dictionary.md` 口径高度重叠 | 两文件对比 | 口径不唯一，面试被追问时容易自相矛盾 |
| S3 | 内部协作/临时目录被跟踪：`.impeccable/`、`.tmp_docx/`、`.obsidian/`、`.worktrees/`、`docs/codex/`、`docs/superpowers/` | `git status` 大量 D | 暴露开发过程噪音，稀释"产品"叙事 |
| S4 | `tsconfig.tsbuildinfo`（≈675KB 构建产物）被跟踪，但 `.gitignore` 已声明忽略 `*.tsbuildinfo` | 文件已跟踪 | 仓库体积无谓膨胀 |
| S5 | 两套评测入口并存：legacy `eval/*.mjs` 脚本 + `lib/evaluation/` 域逻辑，README 同时介绍"旧版脚本" | README L191-221 | 招聘方分不清哪套是真正在用的评测系统 |
| S6 | 三个根目录启动脚本（`start-ai-hook-lab.bat`、`start-ai-hook-dashboard.bat`、`start-ai-hook-mac.command`）平铺在根 | 根目录 | 根目录信息密度过高，弱化核心目录 |
| S7 | `.impeccable/` 未写入 `.gitignore`（虽已被删），可能再次被误提交 | `.gitignore` 无该项 | 清理不彻底会反复 |
| E1 | `docs/evidence/evidence-manifest.json` 中受控测试、离线提升值仍为 `not_verified`，与简历"数字"存在缺口，尚未做产品决策 | manifest L11-38 | 证据闭环未收口 |

---

## 2. 目标仓库结构（重梳理后的 target tree）

原则：**根目录只保留招聘方和开发者第一眼需要的东西**；所有说明性文档归入 `docs/` 且单一权威；构建产物、临时文件、内部协作记录一律不跟踪。

```text
ai-hook-lab/
├── README.md                      # 唯一入口：30 秒招聘方入口 + 快速开始 + 结构说明
├── LICENSE
├── SECURITY.md
├── package.json / tsconfig.json / next.config.ts / eslint.config.mjs / postcss.config.mjs
├── app/                           # 页面与 Route Handlers（不动）
├── components/                    # UI 组件（不动）
├── hooks/                         # 前端状态（不动）
├── lib/                           # generation / agent / evaluation 域逻辑（不动）
├── db/migrations/                 # PostgreSQL 迁移（不动）
├── eval/                          # 离线评测脚本与固定案例（保留，README 明确其与 lib/evaluation 的关系）
├── scripts/                       # 密钥扫描、证据校验、开发辅助（不动）
├── test/                          # 测试装载器（不动）
├── data/                          # 本地 JSON（.gitignore 已忽略内容，保留目录占位）
├── tools/                         # 【新增】启动脚本收纳：start-*.bat / start-*.command
└── docs/
    ├── product/                   # 产品权威文档（策略、指标字典、业务闭环、治理、迭代日志、真实用户计划、模拟方法）
    ├── evidence/                  # 证据索引、主张审计、证据指标字典、manifest、报告
    ├── portfolio/                 # 招聘方向：AI 协作边界、Demo 验证、运营 Agent、截图资产
    ├── prd/                       # PRD（保留 .md，删除随附的 .docx 二进制或移出仓库）
    ├── creative-agent.md
    └── evaluation-system.md
```

**移除/不再跟踪**：`PRD.md`、`DESIGN.md`、`PRODUCT.md`、`deep-research-report.md`（根级）、`.impeccable/`、`.tmp_docx/`、`.obsidian/`、`.worktrees/`、`docs/codex/`（本计划文件除外，见任务 T7）、`docs/superpowers/`、`tsconfig.tsbuildinfo`。

---

## 3. Codex 执行任务清单（按顺序）

每个任务给出：目的 → 操作 → 交付物 → 验收 → 分工。Codex 逐条执行，完成一项在下面勾选并附一句证据（命令输出或文件路径）。

### 阶段 A：仓库结构收口（对应 S1–S7、诊断 P0-2/P1）

- [x] **T1｜确认并整理已有清理结果**
  - 目的：避免与 `codex/cleanup-project` 的删除动作冲突或重复。
  - 操作：核对当前 `master` 工作区已暂存的删除是否与 §2 目标一致；如一致则整理为一次结构清理提交，如不一致以 §2 为准。
  - 交付物：一个干净的 `git status`（只剩本计划要求的改动）。
  - 验收：`git status --short` 输出可解释，无意外文件。
  - 分工：Codex 执行；本人确认删除清单无误后授权提交。
  - 证据：`master@40506d7` 已形成独立结构清理提交；`codex/cleanup-project` 为过时分支，不再合并。后续证据工作从 `master@3d3bc47` 的干净 worktree 开始。

- [x] **T2｜根目录说明文档去重**
  - 目的：解决 S1，根目录只留 README/LICENSE/SECURITY。
  - 操作：核对根级 `PRD.md`/`DESIGN.md`/`PRODUCT.md`/`deep-research-report.md` 的内容是否已被 `docs/prd/`、`docs/product/`、`docs/product/product-strategy.md` 覆盖；覆盖则删除根级文件，未覆盖的独有内容先并入对应 docs 文件再删除。`DESIGN.md`（设计系统 token）如仍需要，移动到 `docs/design-system.md`。
  - 交付物：根目录不再有上述四个文件；README「进一步阅读」链接全部有效。
  - 验收：`ls *.md`（根）仅剩 `README.md`；README 内所有相对链接可点击。
  - 分工：Codex 执行去重与移动；本人裁定哪份是权威版本。
  - 证据：`40506d7` 删除根级重复文档并将 `DESIGN.md` 的独有内容保留为 `docs/design-system.md`；本轮本地链接检查覆盖全部 Markdown。

- [x] **T3｜停止跟踪构建产物与临时目录**
  - 目的：解决 S3/S4/S7。
  - 操作：`git rm -r --cached tsconfig.tsbuildinfo .impeccable .obsidian .worktrees .tmp_docx docs/superpowers`（对仍被跟踪者）；在 `.gitignore` 补充 `/.impeccable/` 一行（其余已存在）。
  - 交付物：这些路径从 Git 索引移除但保留在本地磁盘（临时文件除外）。
  - 验收：`git ls-files | grep -E '\.impeccable|\.obsidian|tsbuildinfo|\.tmp_docx|superpowers'` 无输出。
  - 分工：Codex 执行；本人无需介入。
  - 证据：`40506d7` 已停止跟踪目标路径并补齐忽略规则；`git ls-files` 复核无匹配输出。

- [x] **T4｜启动脚本收纳到 `tools/`**
  - 目的：解决 S6，降低根目录密度。
  - 操作：新建 `tools/`，移动三个 `start-*` 脚本；更新 README「一键启动」段落中的路径。
  - 交付物：`tools/start-ai-hook-lab.bat` 等三个文件；README 路径同步。
  - 验收：按 README 新路径能定位脚本；脚本内部相对路径（若有）仍指向仓库根。
  - 分工：Codex 执行；本人验证 Windows/macOS 启动器仍可用（或标注未测环境）。
  - 证据：三个启动器已在 `tools/`；README 路径和启动器契约测试均指向新位置。

- [x] **T5｜指标字典单一权威化**
  - 目的：解决 S2，面试口径唯一。
  - 操作：以 `docs/evidence/metrics-dictionary.md`（含排除条件、可对外名称，更严格）为权威；将 `docs/product/metrics-dictionary.md` 改为**指向证据版的短跳转页**（保留一句定位说明 + 链接），或反向合并，二选一由本人定。所有 README/文档中的"指标字典"链接指向同一份。
  - 交付物：仅一份实质指标字典，另一份为跳转。
  - 验收：全仓库 `grep -rl "指标字典" docs` 的链接目标一致。
  - 分工：本人裁定权威版本与最终口径；Codex 执行合并与改链接。
  - 证据：`docs/evidence/metrics-dictionary.md` 为唯一实质口径；`docs/product/metrics-dictionary.md` 仅为跳转页。

### 阶段 B：招聘方入口与叙事收口（对应诊断 P0-3、P1、P2）

- [x] **T6｜README 结构说明与评测双系统澄清**
  - 目的：解决 S5，并让「项目结构」段落与 §2 目标一致。
  - 操作：在 README「离线评测」段用一句话说明关系：`lib/evaluation/` 是产品内评测系统（带盲评/裁决/导出），`eval/*.mjs` 是命令行冒烟与批量脚本，二者共用同一套 60 固定案例；更新「项目结构」代码块加入 `tools/`、`docs/portfolio`、`docs/evidence`。
  - 交付物：README 无"旧版脚本"这类会引发"哪个是真的"疑问的措辞。
  - 验收：本人以招聘方视角 30 秒通读，能明确"这是一套评测系统 + 一组脚本"。
  - 分工：Codex 起草；本人定稿措辞。
  - 证据：`3d3bc47` 已明确 `lib/evaluation/` 为产品内评测能力、`eval/*.mjs` 为共用 60 固定案例的命令行入口。

- [x] **T7｜保留本计划并归档 Codex 协作记录**
  - 目的：`docs/codex/` 其余内部文件删除后，仅保留对外可解释的协作痕迹。
  - 操作：保留本文件 `docs/codex/2026-07-21-repo-restructure-and-evidence-plan.md`；删除其余 `docs/codex/*` 历史内部计划（已在 T1 清理范围）；在 `docs/portfolio/ai-collaboration.md` 增补一句指向本计划，作为"贡献边界"的落地佐证。
  - 交付物：`docs/codex/` 仅剩本计划；`ai-collaboration.md` 有交叉链接。
  - 验收：`ls docs/codex/` 只列出本文件。
  - 分工：Codex 执行。
  - 证据：`docs/codex/` 仅跟踪本计划，`docs/portfolio/ai-collaboration.md` 已建立交叉链接。

- [ ] **T8｜Demo 验活入口对齐（诊断 P0-3）**
  - 目的：README 的 `https://hookovo.icu/` 与实际可访问性、`docs/portfolio/demo-verification.md` 三者一致。
  - 操作：不改代码，只做入口对齐——确认 README 顶部 Demo 链接、`demo-verification.md` 的最近验活日期、以及"若线上不稳定则优先 GitHub + 录屏"的兜底说明齐备；若认养项目 README 仍有"在线演示 TODO"由本人在对应仓库修正（本仓库仅需自查）。
  - 交付物：`demo-verification.md` 有 2026-07-21 或更新的验活条目模板（本人填真实结果）。
  - 验收：README Demo 链接、验证记录、兜底说明三处不矛盾。
  - 分工：本人负责真实验活（手机流量/无痕/桌面三端复测并填结果）；Codex 只保证入口结构与占位齐备。
  - 当前状态：README、自动检查、截图和兜底说明已齐备；等待本人填写三端真实验活结果，Codex 不代填。

### 阶段 C：证据闭环决策（对应诊断 P0-1，最高优先级判断）

- [ ] **T9｜路线甲——补齐受控测试证据**
  - 目的：解决 E1；本人已选择公开脱敏 CSV 路线，计算结果以真实文件为准，不预设或反推简历数字。
  - 数据：负责人批准公开后，将逐 Hook 记录放在 `docs/evidence/data/controlled-test.csv`；固定表头与隐私约束见同目录 README。
  - 操作：`scripts/analyze-controlled-test.mjs` 使用 TS 加载器导入既有 `BAD_CASE_TYPES`，计算总样本、有效样本、收藏率、测试内选择率、Bad Case 与护栏分布；`scripts/analyze-controlled-test.test.ts` 已纳入 `npm test`。
  - 状态升级：只有脚本校验通过且本人核对分子、分母、来源后，才更新 manifest 的 `status`、`sources` 和 `measurement`；结果与简历不一致时同步修改简历，不修改数据迎合简历。
  - 交付物：`evidence-manifest.json` 每条 claim 状态与简历表述一致，无"简历写了、仓库查不到"的缺口。
  - 验收：`npm run evidence:verify` 通过；`docs/evidence/claims-audit.md` 的"对外处理"列与简历实际用词逐条一致。
  - 分工：**本人决策并提供任何真实数据**；Codex 执行脚本与文档；**Codex 严禁根据简历结果反推/编造原始数据**。
  - 当前状态：本人已选择路线甲和公开脱敏 CSV；分析器、测试、数据契约与 manifest 对照校验已实现。等待本人提供并批准真实 CSV、核对计算结果及提供当前投递版简历。
  - 边界：受控测试 CSV 不能证明 `+20pp/+41.7pp`，两项离线提升继续保持 `not_verified`。

- [x] **T10｜SQL 技能证据决策（诊断 P2）**
  - 目的：与仓库证据一致。当前简历已删 SQL；若走路线甲产出了查询/分析脚本，可作为 SQL 证据回写。
  - 操作：保持简历删除 SQL 的状态；JavaScript 分析脚本不作为 SQL 能力证据。
  - 交付物：结论明确（"暂不回写"或"以某脚本为证回写"）。
  - 验收：仓库不出现无对应产出的 SQL 宣称。
  - 分工：本人裁定。
  - 证据：本人已裁定“暂不回写 SQL”；`claims-audit.md` 记录该决定。

---

## 4. 最终验收清单（Definition of Done）

结构与入口：
- [x] 根目录仅剩 `README.md`、`LICENSE`、`SECURITY.md` 三个说明文件 + 配置文件 + 代码目录。
- [x] `git ls-files` 不含构建产物、临时目录、内部协作记录。
- [x] 全仓库仅一份实质指标字典，链接一致。
- [x] 启动脚本在 `tools/`，README 路径同步。
- [x] README 30 秒入口本地链接全部有效，评测双系统关系一句话说清。

证据与可防守性：
- [x] `npm run evidence:verify` 通过（1 条已验证、4 条继续 withheld；待真实 CSV 后重跑）。
- [ ] `evidence-manifest.json` / `claims-audit.md` / 简历三者对同一数字的口径一致，无缺口。
- [x] `docs/portfolio/ai-collaboration.md` 的贡献边界表可回答"这么多功能一周怎么做完 / Codex 做了多少"。
- [ ] `demo-verification.md` 有本人填写的最近一次三端验活结果。

工程回归（不因清理而破坏）：
- [x] `npm run lint`、`npm test`、`npm run build`、`npm run security:scan` 均在仓库外的干净 evidence worktree 中通过（249 tests）。

---

## 5. Codex 明确禁止事项

1. 不得为任何简历数字反向生成或"补全"原始测试数据。
2. 不得把 Mock、模型自评分或"测试内选择"改名为真实发布效果/点击率。
3. 不得替本人做 T9 证据路线决策、T5/T2 权威版本裁定、T8 真实验活。
4. 删除文件前先确认内容已在目标位置留存（尤其 T2 去重）；不确定则先移动不删除。
5. 结构改动与证据改动分成独立提交，便于本人分别核对。
