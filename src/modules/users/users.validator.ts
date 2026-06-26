import { Request } from 'express';
import { Validator } from '../../common/validator';

export function validateCreateUser(req: Request): void {
  new Validator(req.body)
    .required('email', 'Email')
    .email('email', 'Email')
    .required('password', 'Password')
    .minLength('password', 8, 'Password')
    .strongPassword('password', 'Password')
    .required('firstName', 'First name')
    .required('lastName', 'Last name')
    .throw();
}

export function validateUpdateUser(req: Request): void {
  new Validator(req.body)
    .string('firstName', 'First name')
    .maxLength('firstName', 50, 'First name')
    .string('lastName', 'Last name')
    .maxLength('lastName', 50, 'Last name')
    .string('avatar', 'Avatar')
    .throw();
}

export function validateUpdateProfile(req: Request): void {
  new Validator(req.body)
    .string('firstName', 'First name')
    .maxLength('firstName', 50, 'First name')
    .string('lastName', 'Last name')
    .maxLength('lastName', 50, 'Last name')
    .string('avatar', 'Avatar')
    .throw();
}

export function validateAssignRole(req: Request): void {
  new Validator(req.body).required('roleId', 'Role ID').throw();
}
