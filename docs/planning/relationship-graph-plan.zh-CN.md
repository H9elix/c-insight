# C Insight 综合关系图设计与实施记录

> 状态：已完成。本文保存 `0.12.0` 的原始设计约束以及 `0.12.0`–`0.12.8` 的实施记录；当前 `0.22.7` 用户行为以用户手册为准，架构所有权以开发者手册和源码为准。

## 1. 目标

原始 `0.12.0` 目标是增加一个独立的 Relationship Graph，用同一画布查看并继续展开三类已经具备可靠数据源的关系：

- 函数调用：Caller → Callee
- 类型继承：Supertype → Subtype
- 文件包含：Including File → Included File

关系图用于理解局部结构和跨关系导航，不替代现有 Callers/Callees、Supertypes/Subtypes、Includes/Included By 树。树适合精确逐层浏览，图适合观察分支、汇合、环和不同关系之间的整体结构。

## 2. 首版范围

### 必须实现

- 编辑器区域中的可缩放、可平移 SVG 图画布。
- 从当前函数、类型或文件显式执行 **Show Relationship Graph**。
- 节点级按需展开，不在打开图时扫描完整工作区。
- Call、Inheritance、Include 三种边可分别显示或隐藏。
- 节点搜索、Fit、Reset Layout、停止加载。
- 单击节点更新 Code Preview；双击节点在主编辑器打开。
- 右键节点支持 Expand、Open Location、Add Bookmark。
- 循环、重复、深度上限、节点上限、stale 和取消状态可见。
- 导出统一 JSON 和 Mermaid；JSON 沿用 0.11.9 的版本化层级字段思想，但使用适合一般图的 `nodes` 和 `edges`。
- 所有查询都由扩展宿主执行；Webview 只渲染经过校验的数据。

### 首版不实现

- References 边。引用数量通常远大于调用/继承/包含关系，直接加入会使图迅速失控；后续应先设计聚合节点和过滤规则。
- 自动跟随编辑器光标。首版只响应显式 Show/Replace Root，避免光标移动不断重建布局和发起查询。
- 跨工作区会话恢复（原始首版排除，后在 `0.12.8` 完成静态快照恢复）。
- 全工作区一次性关系数据库。
- 复杂物理仿真布局、3D 图和自动社区检测。
- 在 Webview 内执行 clangd 请求或访问本地文件。

## 3. 界面形式

推荐使用 `WebviewPanel` 打开在编辑器区域，而不是继续占用窄侧栏。图需要稳定的二维空间，编辑器标签页也便于并排放置源码和 Code Preview。

顶部工具栏按以下顺序排列：

1. Replace Root
2. Call / Inheritance / Include 关系过滤开关
3. Expand Selected
4. Expand to Depth
5. Stop
6. Search
7. Fit
8. Reset Layout
9. Export

节点视觉：

| 节点类型 | 默认图标/色彩语义 | 可展开关系 |
| --- | --- | --- |
| Function/Method | 函数符号色 | Callers、Callees |
| Class/Struct/Interface | 类型符号色 | Supertypes、Subtypes |
| Source/Header | 文件符号色 | Includes、Included By |
| Unresolved | 警告色、虚线边框 | 无 |

边始终使用真实语义方向。视觉布局改变时箭头含义不改变。

## 4. 交互逻辑

- 单击：选择节点，并通过现有导航管线更新 Code Preview 和 Navigation History，不移动主编辑器。
- 双击：打开节点的定义或文件位置。
- `Enter`：展开当前节点上次使用的关系方向。
- 右键 Expand：显示该节点当前支持的具体方向，不做隐式猜测。
- 展开已有节点：合并相同稳定 ID 的节点，不复制实体；新增边可以连接到现有节点，从而显示汇合和循环。
- Replace Root：清空当前图并建立新根。
- Add as Root/Focus：保留图数据，只把选中节点作为布局中心。
- 源码、clangd、编译数据库或 include 配置变化后标记 stale；已有图仍可导航，Refresh/Replace Root 后重新查询。

## 5. 统一图模型

扩展宿主持有唯一事实来源：

```ts
interface RelationshipGraph {
  schemaVersion: 1;
  rootId: string;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  revision: number;
  staleReason?: string;
}

interface GraphNode {
  id: string;
  kind: "function" | "method" | "type" | "source" | "header" | "unresolved";
  name: string;
  detail?: string;
  uri?: string;
  line?: number;
  states: string[];
  capabilities: GraphRelation[];
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: "calls" | "inherits" | "includes";
  sourceUri?: string;
  line?: number;
  states: string[];
}
```

稳定节点 ID 应由关系种类、规范化 URI、选择范围和语义名称组成。边 ID 由 `relation + from + to + source location` 组成。不得使用 Webview 临时序号作为业务身份。

## 6. 数据层设计

新增 `RelationshipGraphService`，通过三个适配器获取数据：

- `CallGraphAdapter`：复用 `AnalysisService` 的 Call Hierarchy 请求。
- `TypeGraphAdapter`：复用 Type Hierarchy 请求及 clangd opaque `data`。
- `IncludeGraphAdapter`：复用 include resolver 和按需 reverse index。

现有窗口和图服务最终应共享请求缓存，但 0.12.0 不应为了复用而直接访问各 Explorer 的私有 UI 状态。先抽出只含查询与缓存的 repository，再由树和图共同调用。

Included By 仍遵循现有规则：只有用户明确展开 Included By 时才建立反向索引，显示进度并允许取消。打开图或展开 Includes 不得顺带触发该扫描。

## 7. 布局与渲染

首版不引入大型前端图形依赖，使用 CSP 限制下的原生 SVG：

- 默认采用确定性的分层布局。
- 根位于中心；incoming/supertype/included-by 放在左侧，outgoing/subtype/includes 放在右侧。
- 同层按稳定 ID 排序，保证相同数据重开时布局尽量一致。
- 循环边使用曲线；多重边按关系类型偏移。
- Webview 维护缩放、平移和节点拖动位置，扩展宿主维护语义图。
- 大于可视阈值时只渲染视口附近标签，边和节点总数仍受宿主限制。

如果真实工程证明分层布局无法处理常见图，再单独评估轻量布局库；不能在首版未经测量就加入体积较大的依赖。

## 8. 资源与可靠性边界

建议新增配置：

| 配置 | 默认值 | 范围 | 作用 |
| --- | ---: | ---: | --- |
| `cInsight.relationshipGraph.defaultDepth` | `1` | 0–5 | 建立根后显式加载的初始层数 |
| `cInsight.relationshipGraph.maximumDepth` | `10` | 1–50 | 单路径绝对深度 |
| `cInsight.relationshipGraph.maximumNodes` | `500` | 50–10000 | 图节点总上限 |
| `cInsight.relationshipGraph.maximumEdges` | `1000` | 100–50000 | 图边总上限 |
| `cInsight.relationshipGraph.layout` | `layered` | `layered` | 首版布局策略 |
| `cInsight.relationshipGraph.includeSystemHeaders` | `false` | boolean | 是否允许系统头进入图 |

每次批量展开必须：

- 有进度通知和 Stop。
- 支持 CancellationToken。
- 使用 generation/revision 丢弃迟到响应。
- 达到节点、边或深度限制时在画布内显示明确状态。
- 不因隐藏图标签页而继续新的自动查询；已经发起的显式批量操作可以由用户停止。

## 9. Webview 安全边界

- 使用随机 nonce 和严格 CSP。
- 只允许本地脚本/样式资源。
- Webview 消息使用判别联合类型并在扩展宿主再次验证。
- URI、位置、关系方向、深度和节点 ID 均不能直接信任 Webview。
- Webview 不读取文件、不启动进程、不保存工作区状态、不调用 LSP。
- HTML 中的节点名称、路径和详情必须转义。

## 10. 导出格式

JSON：

```json
{
  "schemaVersion": 1,
  "rootId": "node-id",
  "nodes": [],
  "edges": [],
  "staleReason": null
}
```

Mermaid 根据 `GraphEdge.from` 和 `GraphEdge.to` 直接输出，不再根据当前视图方向二次推断。Text 以节点清单和边清单两部分输出，避免把一般图伪装成没有汇合的树。

## 11. 测试策略

- 纯单元测试：稳定 ID、节点/边合并、循环、预算、revision、导出和布局输入。
- 集成测试：三个 Adapter 的方向和取消行为。
- Webview 消息测试：非法 ID、越界深度、未知消息和 HTML 转义。
- VS Code E2E：命令注册、面板打开、根替换、单击预览、双击打开、导出。
- 大工程手工验证：FFmpeg 上的局部调用图、Include 图、Included By 首次扫描取消及节点/边上限。

## 12. 实现顺序

### 0.12.0-A：模型与宿主骨架

1. 实现纯 `RelationshipGraph` 模型、稳定 ID、合并、预算和导出测试。
2. 注册 Relationship Graph 面板、命令和配置。
3. 建立严格 CSP 与消息协议，先用静态测试图验证缩放、平移、选择和布局。

### 0.12.0-B：Call Graph

1. 抽取共享 Call Hierarchy repository。
2. 接入当前函数根、Callers/Callees 单节点展开。
3. 接入 Code Preview、Open Location、Bookmark、History。
4. 验证递归、重复目标合并和间接调用状态。

### 0.12.0-C：Type 与 Include

1. 接入 Supertypes/Subtypes。
2. 抽取并接入 include resolver/reverse index。
3. 保证 Included By 扫描仅由显式动作触发。
4. 完成三种关系过滤和混合节点布局。

### 0.12.0-D：完整交互与硬化

1. Search、Fit、Reset、Expand to Depth、Stop。
2. JSON、Mermaid、Text 导出。
3. stale、限制、错误和取消状态。
4. 单元、集成、E2E、FFmpeg 手工验证、手册和打包。

Call Graph 的 A、B、D 阶段已在 `0.12.0`–`0.12.2` 完成，Type Adapter 已在 `0.12.3` 完成，Include Adapter 已在 `0.12.4` 完成。`0.12.5` 完成关系样式、图例、节点状态、无查询折叠、稳定视口、过滤统计和键盘操作；`0.12.6` 完成按帧合并、稳定 ID 增量 SVG、视口虚拟化、线性分层遍历、慢渲染诊断、关闭释放和大型合成图回归测试；`0.12.7` 通过显式 Definition 归属边接通 File、Type 与 Callable 节点；`0.12.8` 接入版本化、有界的 Workspace Session 静态恢复。三类关系、混合关系、性能硬化和退出时打开面板的静态恢复均已完成；用户主动关闭面板会清除保留图，重新打开工作区时不会恢复已关闭的图。

## 13. 验收标准

- 用户可从函数、类型或文件显式打开关系图。
- 任一节点只在用户展开时查询下一层。
- 三类关系的箭头方向正确且可过滤。
- 同一语义实体在画布上合并为一个节点，循环不会无限展开。
- 单击预览、双击打开与现有窗口逻辑一致。
- 达到资源上限、取消或 stale 时有明确反馈。
- 隐藏/未打开图时没有自动关系查询。
- Included By 不会因打开图或其他关系展开而意外扫描工作区。
- 导出不触发查询，且 JSON/Mermaid 能完整表达已加载的一般图。
