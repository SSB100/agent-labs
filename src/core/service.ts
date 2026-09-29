import type {
  AppendOnlyContractKind,
  ContractFor,
  CoreContractKind,
  MutableContractKind,
} from "./contracts";
import type {
  ContractListOptions,
  ContractScope,
  CoreRepository,
  WritableContractKind,
} from "./repository";
import { validateCoreContract } from "./validation";

export interface CoreStateService {
  get<K extends CoreContractKind>(
    kind: K,
    id: string,
    scope: ContractScope<K>,
  ): Promise<ContractFor<K> | null>;

  list<K extends CoreContractKind>(
    kind: K,
    options: ContractListOptions<K>,
  ): Promise<readonly ContractFor<K>[]>;

  create<K extends WritableContractKind>(kind: K, value: unknown): Promise<ContractFor<K>>;

  append<K extends AppendOnlyContractKind>(kind: K, value: unknown): Promise<ContractFor<K>>;

  update<K extends MutableContractKind>(kind: K, value: unknown): Promise<ContractFor<K>>;
}

export class ValidatedCoreStateService implements CoreStateService {
  constructor(private readonly repository: CoreRepository) {}

  get<K extends CoreContractKind>(
    kind: K,
    id: string,
    scope: ContractScope<K>,
  ): Promise<ContractFor<K> | null> {
    return this.repository.get(kind, id, scope);
  }

  list<K extends CoreContractKind>(
    kind: K,
    options: ContractListOptions<K>,
  ): Promise<readonly ContractFor<K>[]> {
    return this.repository.list(kind, options);
  }

  async create<K extends WritableContractKind>(
    kind: K,
    value: unknown,
  ): Promise<ContractFor<K>> {
    const record = validateCoreContract(kind, value);
    return this.repository.create(kind, record);
  }

  async append<K extends AppendOnlyContractKind>(
    kind: K,
    value: unknown,
  ): Promise<ContractFor<K>> {
    const record = validateCoreContract(kind, value);
    return this.repository.append(kind, record);
  }

  async update<K extends MutableContractKind>(
    kind: K,
    value: unknown,
  ): Promise<ContractFor<K>> {
    const record = validateCoreContract(kind, value);
    return this.repository.update(kind, record);
  }
}
