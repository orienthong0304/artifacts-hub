/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 渲染子域地址（开发默认 http://localhost:5174，生产注入 https://run.artifacts.orienthong.cn） */
  readonly VITE_RUNNER_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
