// src/pages/api/prisma_example.ts
import type { NextApiRequest, NextApiResponse } from "next";
// import { prisma } from "../../server/db/client";

const examples = async (req: NextApiRequest, res: NextApiResponse) => {
    // const examples = await prisma.account.findMany();
    res.status(200).json({});
};

export default examples;
