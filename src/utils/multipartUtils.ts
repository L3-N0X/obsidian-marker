import {TFile} from "obsidian";

// Interface for multipart form field
export interface FormField {
  name: string;
  value: string | boolean | number | null;
}

// Return type from building the multipart
export interface MultipartRequestBody {
  body: ArrayBuffer;
  boundary: string;
}

export class MarkerMultipartRequest {
  private constructor() {}

  /**
   * Builds the multipart request body
   */
  public static build(
    boundary: string,
    file: TFile,
    fileContent: ArrayBuffer,
    fields: FormField[]
  ): MultipartRequestBody {
    const parts: (string | Uint8Array)[] = [];

    // Add the file part
    const contentType = this.getContentTypeForFile(file);
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    parts.push(new Uint8Array(fileContent));
    parts.push('\r\n');

    // Add other form fields
    for (const field of fields) {
      if (field.value !== null && field.value !== undefined) {
        parts.push(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`
        );
      }
    }

    // Add closing boundary
    parts.push(`--${boundary}--\r\n`);

    // Combine all parts into a single ArrayBuffer
    return {
      body: this.combinePartsToArrayBuffer(parts),
      boundary: boundary,
    };
  }

  /**
   * Determines the content type for a file based on its extension
   */
  public static getContentTypeForFile(file: TFile): string {
    switch (file.extension) {
      case 'pdf':
        return 'application/pdf';
      case 'docx':
      case 'doc':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'pptx':
      case 'ppt':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        console.error(
          `Unrecognized file extension: ${file.extension}, using generic content type`
        );
        return 'application/octet-stream';
    }
  }

  /**
   * Combines parts into a single ArrayBuffer
   */
  public static combinePartsToArrayBuffer(
    parts: (string | Uint8Array)[]
  ): ArrayBuffer {
    // Convert string parts to Uint8Array
    const bodyParts = parts.map((part) =>
      typeof part === 'string' ? new TextEncoder().encode(part) : part
    );

    // Calculate total length
    const bodyLength = bodyParts.reduce(
      (acc, part) => acc + part.byteLength,
      0
    );

    // Create and fill the combined buffer
    const body = new Uint8Array(bodyLength);
    let offset = 0;
    for (const part of bodyParts) {
      body.set(part, offset);
      offset += part.byteLength;
    }

    return body.buffer;
  }
}
