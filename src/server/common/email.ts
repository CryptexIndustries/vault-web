import { env } from "../../env/server.mjs";

// Type for respose 200 from Infobip
/*
{
    "bulkId": "snxemd8u52v7v84iiu69",
    "messages": [
        {
            "to": "john.smith@somecompany.com",
            "messageId": "jgzra46v9zi1ztvd62t5",
            "status": {
                "groupId": 1,
                "groupName": "PENDING",
                "id": 26,
                "name": "PENDING_ACCEPTED",
                "description": "Message accepted, pending for delivery."
            }
        }
    ]
}
*/

// All other error responses
/*
{
    "requestError": {
        "serviceException": {
            "messageId": "BAD_REQUEST",
            "text": "Bad request"
        }
    }
}
*/

type InfobipEmailSendResponse = {
    bulkId?: string;
    messages?: [
        {
            to: string;
            messageId: string;
            status: {
                groupId: number;
                groupName: string;
                id: number;
                name: string;
                description: string;
            };
        },
    ];
    /*
     * In case we receive anything other than 200 OK, this will be populated with the error message.
     */
    requestError?: {
        serviceException: {
            messageId: string;
            text: string;
        };
    };
};

const sendEmailRequest = async (
    data: FormData,
): Promise<InfobipEmailSendResponse> => {
    if (!env.INFOBIP_BASE_URL || !env.INFOBIP_API_KEY) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const response = await fetch(`${env.INFOBIP_BASE_URL}/email/3/send`, {
        method: "POST",
        headers: {
            Authorization: `App ${env.INFOBIP_API_KEY}`,
        },
        body: data,
    });

    return response.json();
};

export const sendContactEmail = async (
    from: string,
    message: string,
): Promise<InfobipEmailSendResponse> => {
    if (!env.EMAIL_SENDER) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const data = new FormData();
    data.append("from", `CryptexVault <${env.EMAIL_CONTACT_US_SENDER}>`);
    data.append("to", env.EMAIL_CONTACT_US_RECEIVER);
    data.append("replyTo", from);
    data.append("subject", "CryptexVault - Contact Form Submission");
    data.append(
        "html",
        `
            <h1>Contact Form Submission</h1>
            <p><strong>From:</strong> ${from}</p>
            <br />
            <hr />
            <br />
            <p>${message}</p>
        `,
    );

    return sendEmailRequest(data);
};

export const sendFeedbackEmail = async (
    from: string | null,
    userID: string,
    reason: "Feature" | "Bug" | "General",
    message: string,
): Promise<InfobipEmailSendResponse> => {
    if (!env.EMAIL_SENDER) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const data = new FormData();
    data.append("from", `Cryptex Vault <${env.EMAIL_CONTACT_US_SENDER}>`);
    data.append("to", env.EMAIL_CONTACT_US_RECEIVER);

    if (from) data.append("replyTo", from);

    data.append("subject", "Cryptex Vault - Feedback Form Submission");
    data.append(
        "html",
        `
            <h1>Feedback Form Submission</h1>
            <p><strong>From:</strong> ${from} (${userID})</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <br />
            <hr />
            <br />
            <p>${message}</p>
        `,
    );

    return sendEmailRequest(data);
};
