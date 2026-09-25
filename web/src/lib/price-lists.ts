// Append a new record when prices change. Never change a published record or
// reuse its filename. Keep previous records publicly available for retention.
// Publication timestamp is Europe/Zagreb.
export const priceLists = [
    {
        filename: "webshop_cryptex-vault.com_U-01_001_25.09.2026_12:00.csv",
        referenceDate: "10.9.2026",
        monthly: { price: "4.99", referencePrice: "4.99" },
        yearly: { price: "50.00", referencePrice: "50.00" },
    },
] as const;

export const currentPriceList = priceLists[priceLists.length - 1]!;
export const currentPriceListUrl = `/prices/${currentPriceList.filename}`;

export function priceListCsv(list: (typeof priceLists)[number]): string {
    return [
        "naziv_usluge,obracunsko_razdoblje,valuta,maloprodajna_cijena,posebni_oblik_prodaje,naziv_posebnog_oblika_prodaje,sidrena_cijena,datum_sidrene_cijene",
        `Cryptex Vault Online Services,mjesec,EUR,${list.monthly.price},ne,,${list.monthly.referencePrice},${list.referenceDate}`,
        `Cryptex Vault Online Services,godina,EUR,${list.yearly.price},ne,,${list.yearly.referencePrice},${list.referenceDate}`,
        "",
    ].join("\r\n");
}
