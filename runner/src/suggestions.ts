// 白名单外依赖 → 白名单内替代方案的确定性映射（契约 §4.1）
//
// 为什么是确定性映射而不是调模型：这些替代关系是固定事实（recharts 能画的图 echarts 也画，
// shadcn 覆盖 antd 的常用组件），查表零成本、零延迟、零费用、结果可预测。
// 战略文档里「AI 修改代码」的价值，在这里以零模型调用的形态兑现了大半。
//
// 用户手边正开着那个生成代码的 AI——我们要做的不是替他改，而是把「该怎么改」讲清楚到
// 他可以直接复制给 AI。suggestion 会进「复制修复提示词」，也会作为芯片显示在错误卡上。

/** 前缀匹配表：按 key 的长度降序匹配，保证 `@mui/material` 优先于 `@mui` */
const SUGGESTIONS: Record<string, string> = {
  // 图表
  echarts: "recharts（白名单内的 React 图表库，API 更贴合组件写法）",
  "echarts-for-react": "recharts",
  "chart.js": "recharts",
  "react-chartjs-2": "recharts",
  "@nivo": "recharts",
  victory: "recharts",
  "@visx": "recharts 或 d3（两者都在白名单内）",

  // 组件库 → shadcn/ui
  antd: "@/components/ui/*（白名单内置 shadcn/ui 全套组件）",
  "@ant-design/icons": "lucide-react",
  "@mui/material": "@/components/ui/*",
  "@mui/icons-material": "lucide-react",
  "@material-ui/core": "@/components/ui/*",
  "@chakra-ui/react": "@/components/ui/*",
  "react-bootstrap": "@/components/ui/*",
  "@mantine/core": "@/components/ui/*",

  // 图标
  "@heroicons/react": "lucide-react",
  "react-icons": "lucide-react",
  "@tabler/icons-react": "lucide-react",

  // 网络
  axios: "浏览器原生 fetch（沙箱内跨域请求受同源策略限制，见下方说明）",
  "swr": "组件内 useEffect + fetch",
  "@tanstack/react-query": "组件内 useEffect + fetch",

  // 时间
  moment: "date-fns（白名单内，体积小得多）",
  dayjs: "date-fns",
  "date-fns-tz": "date-fns",

  // 工具
  uuid: "crypto.randomUUID()（浏览器原生，无需依赖）",
  nanoid: "crypto.randomUUID()",
  ramda: "lodash（白名单内）",
  immer: "普通对象展开或 structuredClone",

  // 动画
  "react-spring": "framer-motion（白名单内）",
  "@react-spring/web": "framer-motion",
  gsap: "framer-motion",

  // 表单 / 校验
  yup: "zod（白名单内）",
  joi: "zod",
  "react-hook-form": "受控组件 + useState（单文件作品无需表单库）",

  // 需要走 html 类型的重型库
  three: "改用「HTML 页面」类型，在文档里用官方 UMD CDN 引入",
  "@react-three/fiber": "改用「HTML 页面」类型 + three 官方 UMD CDN",
  "mapbox-gl": "改用「HTML 页面」类型 + 官方 UMD CDN",
  leaflet: "改用「HTML 页面」类型 + 官方 UMD CDN",
  "monaco-editor": "改用「HTML 页面」类型 + 官方 UMD CDN",
  "@monaco-editor/react": "改用「HTML 页面」类型 + 官方 UMD CDN",

  // 路由 / 状态：单文件作品的常见误用
  "react-router-dom": "单文件作品没有多页路由，用 useState 切换视图即可",
  "react-router": "单文件作品没有多页路由，用 useState 切换视图即可",
  redux: "useState / useReducer（单文件作品无需全局状态库）",
  "@reduxjs/toolkit": "useState / useReducer",
  zustand: "useState / useReducer",
  jotai: "useState / useReducer",

  // 样式方案
  "styled-components": "Tailwind 工具类（runner 内置 Tailwind runtime）",
  "@emotion/react": "Tailwind 工具类",
  "@emotion/styled": "Tailwind 工具类",
};

/** 按长度降序的 key 列表——保证更具体的前缀（@mui/material）先于宽泛的（@mui）命中 */
const KEYS = Object.keys(SUGGESTIONS).sort((a, b) => b.length - a.length);

/**
 * 给出某个越界 specifier 的替代建议；无对应条目返回 undefined（错误卡只展示 source）。
 * 匹配规则：完全相同，或以 `<key>/` 开头（子路径导入，如 `lodash/debounce`）。
 */
export function suggestFor(source: string): string | undefined {
  for (const key of KEYS) {
    if (source === key || source.startsWith(key + "/")) return SUGGESTIONS[key];
  }
  return undefined;
}
