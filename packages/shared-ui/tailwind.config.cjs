/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        // Or if using `src` directory:
        "./src/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            keyframes: {
                "line-appear": {
                    "0%": {
                        opacity: "0",
                    },
                    "50%": {
                        opacity: "1",
                    },
                    "100%": {
                        opacity: "0",
                    },
                },
                "underline-activate": {
                    "0%": {
                        transform: "scaleX(0)",
                        transformOrigin: "center",
                        opacity: "1",
                    },
                    "50%": {
                        transform: "scaleX(1)",
                        opacity: "1",
                    },
                    "100%": {
                        transform: "scaleX(1)",
                        opacity: "0",
                    },
                },
                flicker: {
                    "0%": {
                        opacity: "0.2",
                    },
                    "5%": {
                        opacity: "1",
                    },
                    "10%": {
                        opacity: "0.1",
                    },
                    "15%": {
                        opacity: "1",
                    },
                    "25%": {
                        opacity: "0.3",
                    },
                    "30%": {
                        opacity: "1",
                    },
                    "40%": {
                        opacity: "0.2",
                    },
                    "50%": {
                        opacity: "1",
                    },
                    "60%": {
                        opacity: "0.15",
                    },
                    "70%": {
                        opacity: "1",
                    },
                    "80%": {
                        opacity: "0.2",
                    },
                    "100%": {
                        opacity: "1",
                    },
                },
                "flicker-short": {
                    "0%": {
                        opacity: "0.2",
                    },
                    "10%": {
                        opacity: "1",
                    },
                    "30%": {
                        opacity: "0.4",
                    },
                    "50%": {
                        opacity: "0.5",
                    },
                    "70%": {
                        opacity: "1",
                    },
                    "80%": {
                        opacity: "0.6",
                    },
                    "100%": {
                        opacity: "1",
                    },
                },
                "accordion-down": {
                    from: {
                        height: "0",
                    },
                    to: {
                        height: "var(--radix-accordion-content-height)",
                    },
                },
                "accordion-up": {
                    from: {
                        height: "var(--radix-accordion-content-height)",
                    },
                    to: {
                        height: "0",
                    },
                },
            },
            animation: {
                "line-appear-loop": "line-appear 1500ms ease-in-out infinite",
                "underline-activate":
                    "underline-activate 2s ease-out forwards infinite",
                flicker: "flicker 0.3s ease-in-out forwards",
                "flicker-short": "flicker-short 0.2s ease-in-out forwards",
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            colors: {
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                chart: {
                    1: "hsl(var(--chart-1))",
                    2: "hsl(var(--chart-2))",
                    3: "hsl(var(--chart-3))",
                    4: "hsl(var(--chart-4))",
                    5: "hsl(var(--chart-5))",
                },
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
    variants: {
        extend: {
            display: ["group-hover"],
        },
    },
};
