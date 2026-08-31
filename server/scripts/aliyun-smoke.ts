// 用真实密钥冒烟验证签名实现与服务开通状态（费用：约 0.002 元/次）
//   cd server && npx tsx scripts/aliyun-smoke.ts "测试文本"
import { moderateChunk } from '../src/aliyun-green.js';

const text = process.argv[2] ?? '今天天气真不错，适合出门散步。';
moderateChunk(text).then(
  (level) => {
    console.log(`✅ 审核成功，风险等级: ${level}`);
  },
  (err) => {
    console.error('❌ 审核失败:', err);
    process.exit(1);
  }
);
