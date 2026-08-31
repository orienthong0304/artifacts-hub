// 测试样例 2：framer-motion 动画卡片（react 类型）
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const CARDS = [
  { id: 1, title: "转译", desc: "浏览器端 Babel 把 TSX 转成 ESM", color: "#D97757" },
  { id: 2, title: "沙箱", desc: "无特权 iframe 隔离执行用户代码", color: "#4C8C6A" },
  { id: 3, title: "白名单", desc: "import map 指向自托管 vendor 包", color: "#5B7DB1" },
];

export default function MotionDemo() {
  const [selected, setSelected] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(true);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-neutral-950 p-8 text-white">
      <motion.h1
        className="text-3xl font-bold"
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        Framer Motion 演示
      </motion.h1>

      <motion.div
        className="h-16 w-16 rounded-2xl"
        style={{ background: "linear-gradient(135deg,#D97757,#8A4FFF)" }}
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { repeat: Infinity, duration: 2.4, ease: "linear" } : { duration: 0.3 }}
        onClick={() => setSpinning((s) => !s)}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
      />
      <p className="text-sm text-neutral-400">点击方块可暂停 / 恢复旋转，点击卡片查看详情</p>

      <div className="flex flex-wrap justify-center gap-4">
        {CARDS.map((card, i) => (
          <motion.button
            key={card.id}
            layout
            className="w-52 rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-left"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.15 }}
            whileHover={{ y: -6, borderColor: card.color }}
            onClick={() => setSelected(card.id === selected ? null : card.id)}
          >
            <div className="mb-2 h-2 w-8 rounded-full" style={{ background: card.color }} />
            <div className="font-semibold">{card.title}</div>
            <AnimatePresence>
              {selected === card.id && (
                <motion.p
                  className="mt-2 text-sm text-neutral-400"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {card.desc}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
