import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './artifacts/**/*.{ts,tsx,js,jsx}',
    './components/**/*.{ts,tsx,js,jsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // 设计 tokens（契约第 6 节）：Claude 风格色板（rgb 三元组形式以支持透明度修饰符）
      colors: {
        bg: "rgb(250 249 245 / <alpha-value>)",        /* --bg #FAF9F5 */
        surface: "rgb(255 255 255 / <alpha-value>)",   /* --surface #FFFFFF */
        ink: {
          DEFAULT: "rgb(26 25 21 / <alpha-value>)",    /* --ink #1A1915 */
          muted: "rgb(110 107 100 / <alpha-value>)",   /* --ink-muted #6E6B64 */
        },
        line: "rgb(232 229 222 / <alpha-value>)",      /* --border #E8E5DE */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        // 强调色：Claude 珊瑚橙（shadcn 组件的 hover/选中态走浅暖底 soft）
        accent: {
          DEFAULT: "rgb(217 119 87 / <alpha-value>)",  /* --accent #D97757 */
          ink: "rgb(255 255 255 / <alpha-value>)",     /* --accent-ink #FFFFFF */
          foreground: "rgb(255 255 255 / <alpha-value>)",
          soft: "hsl(var(--accent-soft))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      // 字体栈（契约第 6 节）
      fontFamily: {
        serif: ["Georgia", "'Times New Roman'", "'Songti SC'", "'Noto Serif CJK SC'", "serif"],
        sans: ["-apple-system", "'PingFang SC'", "'Segoe UI'", "'Microsoft YaHei'", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "12px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
