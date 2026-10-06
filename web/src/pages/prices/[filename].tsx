import type { GetServerSideProps } from "next";
import { priceLists, priceListCsv } from "@/lib/price-lists";

export const getServerSideProps: GetServerSideProps = async ({
    params,
    res,
}) => {
    const list = priceLists.find(
        (entry) => entry.filename === params?.filename,
    );
    if (!list) return { notFound: true };

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${list.filename}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(priceListCsv(list));
    return { props: {} };
};

export default function PriceListDownload() {
    return null;
}
