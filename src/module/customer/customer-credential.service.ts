import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import { requireLoginPassword, requirePassword } from '../../common/validation';
import { PasswordHasherService } from '../auth/password-hasher.service';
import {
  AuditLogService,
  type AuditActorContext,
} from '../audit/audit-log.service';
import { AuditAction, AuditEntityType } from '../audit/domain/audit-log';
import { CustomerCredentialPolicy } from './customer-credential.policy';
import { ChangeCustomerPasswordDto } from './dto/change-customer-password.dto';
import { SetInitialCustomerPasswordDto } from './dto/set-initial-customer-password.dto';
import { Customer } from './schema/customer.entity';

export interface CredentialResult {
  passwordConfigured: true;
}

@Injectable()
export class CustomerCredentialService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordHasher: PasswordHasherService,
    private readonly credentialPolicy: CustomerCredentialPolicy,
    private readonly auditLog: AuditLogService,
  ) {}

  //change customer password
  async changeOwnPassword(
    customerId: string | undefined,
    body: ChangeCustomerPasswordDto,
  ): Promise<CredentialResult> {
    if (customerId === undefined || customerId.length === 0) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    const currentPassword = requireLoginPassword(body.currentPassword);
    const newPassword = requirePassword(body.newPassword);

    return this.dataSource.transaction(async (manager) => {
      const customer = await this.findWithPassword(manager, customerId);

      if (customer === null) {
        throw new UnauthorizedException('Access token is invalid.');
      }

      if (customer.status === 'LOCKED') {
        throw new ForbiddenException('Tai khoan bi khoa.');
      }

      if (
        !(await this.passwordHasher.verify(
          currentPassword,
          customer.passwordHash,
        ))
      ) {
        throw new AppHttpException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
          'Mat khau hien tai khong dung.',
          {
            fieldErrors: {
              currentPassword: [
                {
                  errorCode: ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
                  message: 'Mat khau hien tai khong dung.',
                },
              ],
            },
          },
        );
      }

      if (
        await this.passwordHasher.verify(newPassword, customer.passwordHash)
      ) {
        throw new AppHttpException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.CUSTOMER_PASSWORD_REUSE_NOT_ALLOWED,
          'Mat khau moi phai khac mat khau hien tai.',
          {
            fieldErrors: {
              newPassword: [
                {
                  errorCode: ErrorCode.CUSTOMER_PASSWORD_REUSE_NOT_ALLOWED,
                  message: 'Mat khau moi phai khac mat khau hien tai.',
                },
              ],
            },
          },
        );
      }

      customer.passwordHash = await this.passwordHasher.hash(newPassword);
      customer.tokenVersion += 1;
      await manager.getRepository(Customer).save(customer);

      return { passwordConfigured: true };
    });
  }

  //set initial password for customer
  async setInitialPassword(
    customerId: string,
    body: SetInitialCustomerPasswordDto,
    actor: AuditActorContext,
  ): Promise<CredentialResult> {
    this.validateCustomerId(customerId);
    const password = this.requireInitialPassword(body.password);

    return this.dataSource.transaction(async (manager) => {
      const customer = await this.findWithPassword(manager, customerId);

      if (customer === null) {
        throw new NotFoundException('Khong tim thay customer.');
      }

      const capability = this.credentialPolicy.evaluate(customer);

      if (!capability.canSetInitialPassword) {
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
          'Customer da co mat khau.',
        );
      }

      customer.passwordHash = await this.passwordHasher.hash(password);
      customer.tokenVersion += 1;
      await manager.getRepository(Customer).save(customer);
      await this.auditLog.record(manager, {
        ...actor,
        action: AuditAction.CUSTOMER_INITIAL_PASSWORD_SET,
        entityType: AuditEntityType.CUSTOMER,
        entityId: customer.id,
        metadata: {
          schemaVersion: 1,
          passwordConfiguredBefore: false,
          passwordConfiguredAfter: true,
        },
      });

      return { passwordConfigured: true };
    });
  }

  //get customer with password hash for update
  private findWithPassword(
    manager: EntityManager,
    customerId: string,
  ): Promise<Customer | null> {
    return manager
      .getRepository(Customer)
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :customerId', { customerId })
      .andWhere('customer.deletedAt IS NULL')
      .setLock('pessimistic_write')
      .getOne();
  }

  private validateCustomerId(customerId: string): void {
    if (!/^[1-9][0-9]*$/.test(customerId)) {
      throw new BadRequestException('Id khong hop le.');
    }
  }

  private requireInitialPassword(value: unknown): string {
    try {
      return requirePassword(value);
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : 'message' in response && typeof response.message === 'string'
            ? response.message
            : 'Mat khau khong hop le.';

      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.COMMON_VALIDATION_FAILED,
        message,
        {
          fieldErrors: {
            password: [
              {
                errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
                message,
              },
            ],
          },
        },
      );
    }
  }
}
