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

type InfobipResponse = {
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
        }
    ];
    requestError?: {
        serviceException: {
            messageId: string;
            text: string;
        };
    };
};

const sendRequest = async (data: FormData): Promise<InfobipResponse> => {
    const response = await fetch(`${env.INFOBIP_BASE_URL}/email/3/send`, {
        method: "POST",
        headers: {
            Authorization: `App ${env.INFOBIP_API_KEY}`,
        },
        body: data,
    });

    return response.json();
};

export const sendVerificationEmail = async (
    to: string,
    body: string
): Promise<InfobipResponse> => {
    if (!env.INFOBIP_BASE_URL || !env.INFOBIP_API_KEY || !env.EMAIL_SENDER) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const data = new FormData();
    data.append("from", `CryptexVault <${env.EMAIL_SENDER}>`);
    data.append("to", to);
    // data.append("replyTo", "all.replies@somedomain.com");
    data.append("subject", "CryptexVault - Email Confirmation");
    // data.append(
    //     "text",
    //     "Dear {{name}}, this is mail body text with placeholder in body {{ph1}} "
    // );
    data.append("html", body);

    // data.append("attachment", "@files/image1.jpg");
    // data.append("bulkId", "customBulkId");
    // data.append("intermediateReport", "true");

    // data.append("defaultPlaceholders", '{"ph1": "Success"}');
    // data.append("notifyUrl", "https://www.example.com/email/advanced");
    // data.append("notifyContentType", "application/json");
    // data.append("callbackData", "DLR callback data");

    // var xhr = new XMLHttpRequest();
    // xhr.withCredentials = true;
    // xhr.addEventListener("readystatechange", function () {
    //     if (this.readyState === 4) {
    //         console.log(this.responseText);
    //     }
    // });
    // xhr.open("POST", `${env.INFOBIP_BASE_URL}/email/3/send`);
    // xhr.setRequestHeader("Authorization", `App ${env.INFOBIP_API_KEY}`);
    // xhr.send(data);

    return sendRequest(data);
};

export const sendContactEmail = async (
    from: string,
    message: string
): Promise<InfobipResponse> => {
    if (!env.INFOBIP_BASE_URL || !env.INFOBIP_API_KEY || !env.EMAIL_SENDER) {
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
        `
    );

    return sendRequest(data);
};
