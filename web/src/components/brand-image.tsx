import { useRef } from "react";

export const CryptexVaultLogo = () => {
    const svgRef = useRef<SVGSVGElement>(null);

    return (
        <div className="relative h-full max-h-[120px] w-full max-w-[600px]">
            <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 -10 650 120"
                className="block"
                style={{ width: "100%", height: "100%" }}
            >
                <defs>
                    <style>
                        {`
                            .base {
                                font-family: 'Oxanium', sans-serif;
                                font-size: 72px;
                                letter-spacing: 2px;
                                font-weight: 400;
                            }
                            .glow {
                                filter: url(#glow);
                            }
                            .primary { fill: #FF5668; }
                            .secondary { fill: #25C472; }
                            .tertiary { fill: #FCF8EC; }
                        `}
                    </style>

                    {/* Dual‐color glow filter */}
                    <filter
                        id="glow"
                        x="-50%"
                        y="-50%"
                        width="200%"
                        height="200%"
                    >
                        {/* Tertiary outer glow */}
                        <feFlood floodColor="#FCF8EC" result="f1" />
                        <feComposite
                            in="f1"
                            in2="SourceAlpha"
                            operator="in"
                            result="m1"
                        />
                        <feGaussianBlur in="m1" stdDeviation="5" result="b1" />
                        {/* Secondary inner glow */}
                        <feGaussianBlur
                            in="SourceAlpha"
                            stdDeviation="1"
                            result="b2"
                        />
                        <feMerge>
                            <feMergeNode in="b1" />
                            <feMergeNode in="b2" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <g>
                    {/* "CRYTPEX" with flicker */}
                    <text
                        className="base glow tertiary animate-flicker-short"
                        x="10"
                        y="50"
                    >
                        CRYPTEX
                    </text>

                    <line
                        x1="345"
                        y1="99"
                        x2="405"
                        y2="1"
                        className="glow secondary"
                        stroke="black"
                        strokeWidth="6"
                    />

                    {/* "VAULT" with flicker */}
                    <text
                        className="base glow primary animate-flicker"
                        x="410"
                        y="100"
                    >
                        VAULT
                    </text>
                </g>
            </svg>
        </div>
    );
};
