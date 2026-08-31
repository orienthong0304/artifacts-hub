/// <reference types="vite/client" />

declare module "@babel/standalone";

/** 构建标识：vite define 注入（git sha + vendor manifest 哈希），见 vite.config.ts */
declare const __RUNNER_BUILD__: string;
