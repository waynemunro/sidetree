import Document from './Document';
import DocumentModel from './models/DocumentModel';
import DidState from '../../models/DidState';
import ErrorCode from './ErrorCode';
import SidetreeError from '../../../common/SidetreeError';
import UpdateOperation from './UpdateOperation';

/**
 * Class that handles the composition of operations into final external-facing document.
 */
export default class DocumentComposer {

  /**
   * Transforms the given DID state into a DID Document.
   */
  public static transformToExternalDocument (didState: DidState, didMethodName: string): any {
    // If the DID is revoked.
    if (didState.nextRecoveryCommitmentHash === undefined) {
      return { status: 'revoked' };
    }

    const did = didMethodName + didState.didUniqueSuffix;
    const didDocument = {
      '@context': 'https://w3id.org/did/v1',
      publicKey: didState.document.publicKeys,
      service: didState.document.service,
      recoveryKey: didState.recoveryKey
    };

    DocumentComposer.addDidToDocument(didDocument, did);

    return didDocument;
  }

  /**
   * Applies the update operation to the given document.
   * @returns The resultant document.
   * @throws SidetreeError if invalid operation is given.
   */
  public static async applyUpdateOperation (operation: UpdateOperation, document: any): Promise<any> {
    // The current document must contain the public key mentioned in the operation ...
    const publicKey = Document.getPublicKey(document, operation.signedOperationDataHash.kid);
    if (!publicKey) {
      throw new SidetreeError(ErrorCode.DocumentComposerKeyNotFound);
    }

    // Verify the signature.
    if (!(await operation.signedOperationDataHash.verifySignature(publicKey))) {
      throw new SidetreeError(ErrorCode.DocumentComposerInvalidSignature);
    }

    // The operation passes all checks, apply the patches.
    const resultantDocument = DocumentComposer.applyPatches(document, operation.operationData!.patches);

    return resultantDocument;
  }

  /**
   * Validates the schema of the given full document.
   * @throws SidetreeError if given document patch fails validation.
   */
  public static validateDocument (document: any) {
    if (document === undefined) {
      throw new SidetreeError(ErrorCode.DocumentComposerDocumentMissing);
    }

    const allowedProperties = new Set(['publicKeys', 'service']);
    for (let property in document) {
      if (!allowedProperties.has(property)) {
        throw new SidetreeError(ErrorCode.DocumentComposerUnknownPropertyInDocument, `Unexpected property ${property} in document.`);
      }
    }

    // Verify 'publicKeys' property if it exists.
    if (document.hasOwnProperty('publicKeys')) {
      DocumentComposer.validatePublicKeys(document.publicKeys);
    }

    // Verify 'service' property if it exists.
    if (document.hasOwnProperty('service')) {
      // 'service' property must be an array.
      if (!Array.isArray(document.service)) {
        throw new SidetreeError(ErrorCode.DocumentComposerServiceNotArray);
      }

      // Verify each service entry in array.
      DocumentComposer.validateServiceEndpoints(document.service);
    }
  }

  /**
   * Validates the schema of the given update document patch.
   * @throws SidetreeError if given document patch fails validation.
   */
  public static validateDocumentPatches (patches: any) {
    if (!Array.isArray(patches)) {
      throw new SidetreeError(ErrorCode.DocumentComposerUpdateOperationDocumentPatchesNotArray);
    }

    for (let patch of patches) {
      DocumentComposer.validatePatch(patch);
    }
  }

  private static validatePatch (patch: any) {
    const action = patch.action;
    switch (action) {
      case 'replace':
        DocumentComposer.validateDocument(patch.document);
        break;
      case 'add-public-keys':
        DocumentComposer.validateAddPublicKeysPatch(patch);
        break;
      case 'remove-public-keys':
        DocumentComposer.validateRemovePublicKeysPatch(patch);
        break;
      case 'add-service-endpoints':
        DocumentComposer.validateAddServiceEndpointsPatch(patch);
        break;
      case 'remove-service-endpoints':
        DocumentComposer.validateRemoveServiceEndpointsPatch(patch);
        break;
      default:
        throw new SidetreeError(ErrorCode.DocumentComposerPatchMissingOrUnknownAction);
    }
  }

  private static validateAddPublicKeysPatch (patch: any) {
    const patchProperties = Object.keys(patch);
    if (patchProperties.length !== 2) {
      throw new SidetreeError(ErrorCode.DocumentComposerPatchMissingOrUnknownProperty);
    }

    DocumentComposer.validatePublicKeys(patch.publicKeys);
  }

  private static validatePublicKeys (publicKeys: any) {
    if (!Array.isArray(publicKeys)) {
      throw new SidetreeError(ErrorCode.DocumentComposerPublicKeysNotArray);
    }

    const publicKeyIdSet: Set<string> = new Set();
    for (let publicKey of publicKeys) {
      const publicKeyProperties = Object.keys(publicKey);
      if (publicKeyProperties.length !== 3) {
        throw new SidetreeError(ErrorCode.DocumentComposerPublicKeyMissingOrUnknownProperty);
      }

      if (typeof publicKey.id !== 'string') {
        throw new SidetreeError(ErrorCode.DocumentComposerPublicKeyIdNotString);
      }

      // 'id' must be unique
      if (publicKeyIdSet.has(publicKey.id)) {
        throw new SidetreeError(ErrorCode.DocumentComposerPublicKeyIdDuplicated);
      }
      publicKeyIdSet.add(publicKey.id);

      if (publicKey.type === 'Secp256k1VerificationKey2018') {
        // The key must be in compressed bitcoin-key format.
        if (typeof publicKey.publicKeyHex !== 'string' ||
            publicKey.publicKeyHex.length !== 66) {
          throw new SidetreeError(ErrorCode.DocumentComposerPublicKeySecp256k1NotCompressedHex);
        }
      } else if (publicKey.type !== 'RsaVerificationKey2018') {
        throw new SidetreeError(ErrorCode.DocumentComposerPublicKeyTypeMissingOrUnknown);
      }
    }
  }

  private static validateRemovePublicKeysPatch (patch: any) {
    const patchProperties = Object.keys(patch);
    if (patchProperties.length !== 2) {
      throw new SidetreeError(ErrorCode.DocumentComposerPatchMissingOrUnknownProperty);
    }

    if (!Array.isArray(patch.publicKeys)) {
      throw new SidetreeError(ErrorCode.DocumentComposerPatchPublicKeyIdsNotArray);
    }

    for (let publicKeyId of patch.publicKeys) {
      if (typeof publicKeyId !== 'string') {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchPublicKeyIdNotString);
      }
    }
  }

  /**
   * validate update patch for removing service endpoints
   */
  private static validateRemoveServiceEndpointsPatch (patch: any) {
    if (!Array.isArray(patch.serviceEndpointIds)) {
      throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointIdsNotArray);
    }

    for (const id of patch.serviceEndpointIds) {
      if (typeof id !== 'string') {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointIdsIdNotString);
      }
      if (id.length > 20) {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointIdsIdTooLong);
      }
    }
  }

  /**
   * Validates update patch for adding service endpoints.
   */
  private static validateAddServiceEndpointsPatch (patch: any) {
    if (!Array.isArray(patch.serviceEndpoints)) {
      throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointsNotArray);
    }

    DocumentComposer.validateServiceEndpoints(patch.serviceEndpoints);
  }

  private static validateServiceEndpoints(serviceEndpoints: any[]) {
    for (let serviceEndpoint of serviceEndpoints) {
      if (typeof serviceEndpoint.id !== 'string') {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointIdNotString);
      }
      if (serviceEndpoint.id.length > 20) {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointIdTooLong);
      }
      if (typeof serviceEndpoint.type !== 'string') {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointTypeNotString)
      }
      if (serviceEndpoint.type.length > 30) {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointTypeTooLong);
      }
      if (typeof serviceEndpoint.serviceEndpoint !== 'string') {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointServiceEndpointNotString);
      }
      if (serviceEndpoint.serviceEndpoint.length > 100) {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointServiceEndpointTooLong);
      }

      try {
        // just want to validate url, no need to assign to variable, it will throw if not valid
        // tslint:disable-next-line
        new URL(serviceEndpoint.serviceEndpoint);
      } catch {
        throw new SidetreeError(ErrorCode.DocumentComposerPatchServiceEndpointServiceEndpointNotValidUrl);
      }
    }
  }

  /**
   * Applies the given patches in order to the given document.
   * NOTE: Assumes no schema validation is needed, since validation should've already occurred at the time of the operation being parsed.
   * @returns The resultant document.
   */
  public static applyPatches (document: any, patches: any[]): any {
    // Loop through and apply all patches.
    let resultantDocument = document;
    for (let patch of patches) {
      resultantDocument = DocumentComposer.applyPatchToDidDocument(resultantDocument, patch);
    }

    return resultantDocument;
  }

  /**
   * Applies the given patch to the given DID Document.
   */
  private static applyPatchToDidDocument (document: DocumentModel, patch: any): any {
    if (patch.action === 'replace') {
      return patch.document;
    } else if (patch.action === 'add-public-keys') {
      return DocumentComposer.addPublicKeys(document, patch);
    } else if (patch.action === 'remove-public-keys') {
      return DocumentComposer.removePublicKeys(document, patch);
    } else if (patch.action === 'add-service-endpoints') {
      return DocumentComposer.addServiceEndpoints(document, patch);
    } else if (patch.action === 'remove-service-endpoints') {
      return DocumentComposer.removeServiceEndpoints(document, patch);
    }
  }

  /**
   * Adds public keys to document.
   */
  private static addPublicKeys (document: DocumentModel, patch: any): DocumentModel {
    const publicKeyMap = document.publicKeys ? new Map(document.publicKeys.map(publicKey => [publicKey.id, publicKey])) : new Map();

    // Loop through all given public keys and add them if they don't exist already.
    for (let publicKey of patch.publicKeys) {
      // NOTE: If a key ID already exists, we will just replace the existing key.
      // Not throwing error will minimize the need (thus risk) of reusing exposed update reveal value.
      publicKeyMap.set(publicKey.id, publicKey);
    }

    document.publicKeys = [...publicKeyMap.values()];

    return document;
  }

  /**
   * Removes public keys from document.
   */
  private static removePublicKeys (document: DocumentModel, patch: any): DocumentModel {
    const publicKeyMap = new Map(document.publicKeys.map(publicKey => [publicKey.id, publicKey]));

    // Loop through all given public key IDs and delete them from the existing public key only if it is not a recovery key.
    for (let publicKey of patch.publicKeys) {
      const existingKey = publicKeyMap.get(publicKey);

      if (existingKey !== undefined) {
        publicKeyMap.delete(publicKey);
      }
      // NOTE: Else we will just treat this key removal as a no-op.
      // Not throwing error will minimize the need (thus risk) of reusing exposed update reveal value.
    }

    document.publicKeys = [...publicKeyMap.values()];

    return document;
  }

  private static addServiceEndpoints (document: DocumentModel, patch: any): DocumentModel {
    const serviceEndpoints = patch.serviceEndpoints;

    if (document.service === undefined) {
      // create a new array if service did not exist
      document.service = [];
    }

    const idToIndexMapper = new Map();
    // map all id and their index
    for (const idx in document.service) {
      idToIndexMapper.set(document.service[idx].id, idx);
    }

    for (const serviceEndpoint of serviceEndpoints) {
      if (idToIndexMapper.has(serviceEndpoint.id)) {
        const idx = idToIndexMapper.get(serviceEndpoint.id);
        document.service[idx] = serviceEndpoint;
      } else {
        document.service.push(serviceEndpoint);
      }
    }

    return document;
  }

  private static removeServiceEndpoints (document: DocumentModel, patch: any): DocumentModel {
    if (document.service === undefined) {
      return document;
    }

    const idToIndexMapper = new Map();
    // map all id and their index
    for (const idx in document.service) {
      idToIndexMapper.set(document.service[idx].id, idx);
    }

    const idToRemove = patch.serviceEndpointIds;

    for (const id of idToRemove) {
      if (idToIndexMapper.has(id)) {
        const idx = idToIndexMapper.get(id);
        document.service.splice(idx, 1);
        idToIndexMapper.delete(id);
      }
    }

    return document;
  }

  /**
   * Adds DID references in the given DID document using the given DID
   * because client creating the document will not have these value set.
   * Specifically:
   * 1. `id` is added.
   * 1. `controller` of the public-keys is added.
   *
   * @param didDocument The document to update.
   * @param did The DID which gets added to the document.
   */
  private static addDidToDocument (didDocument: any, did: string): void {

    didDocument.id = did;

    // Only update the publickey if the array is present
    if (Array.isArray(didDocument.publicKey)) {
      for (let publicKeyEntry of didDocument.publicKey) {
        publicKeyEntry.controller = did;
      }
    }
  }
}
