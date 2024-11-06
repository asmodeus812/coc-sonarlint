/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as coc from 'coc.nvim';
import {SslCertificateConfirmationParams} from '../lsp/protocol';

export const DONT_ASK_AGAIN_ACTION = "Don't Ask Again";

export async function showSslCertificateConfirmationDialog(cert: SslCertificateConfirmationParams) {
    const trust = 'Trust';
    const dontTrust = 'Don\'t trust';
    const fingerprints = cert.sha256Fingerprint === '' ? '' :
        `FINGERPRINTS\n
            SHA-256:\n ${cert.sha256Fingerprint}\n
            SHA-1:\n ${cert.sha1Fingerprint}\n`;
    const dialogResponse = await coc.window.showWarningMessage(`
            SonarLint found untrusted server's certificate\n
            Issued to:\n ${cert.issuedTo}\n
            Issued by:\n ${cert.issuedBy}\n
            VALIDITY PERIOD\n
            Valid from: ${cert.validFrom}\n
            Valid to: ${cert.validTo}\n
        ${fingerprints}
            If you trust the certificate, it will be saved in truststore ${cert.truststorePath}\n
            Default password: changeit\n
            Consider removing connection if you don't trust the certificate\n`, dontTrust, trust);
    return dialogResponse == trust
}
