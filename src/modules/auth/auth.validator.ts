import { Request } from 'express';
import { Validator } from '../../common/validator';

export function validateRegister(req: Request): void {
  new Validator(req.body)
    .required('email', 'Email')
    .email('email', 'Email')
    .required('password', 'Password')
    .minLength('password', 8, 'Password')
    .strongPassword('password', 'Password')
    .required('firstName', 'First name')
    .minLength('firstName', 1, 'First name')
    .maxLength('firstName', 50, 'First name')
    .required('lastName', 'Last name')
    .minLength('lastName', 1, 'Last name')
    .maxLength('lastName', 50, 'Last name')
    .throw();
}

export function validateLogin(req: Request): void {
  new Validator(req.body)
    .required('email', 'Email')
    .email('email', 'Email')
    .required('password', 'Password')
    .throw();
}

export function validateForgotPassword(req: Request): void {
  new Validator(req.body).required('email', 'Email').email('email', 'Email').throw();
}

export function validateResetPassword(req: Request): void {
  new Validator(req.body)
    .required('token', 'Reset token')
    .required('password', 'Password')
    .minLength('password', 8, 'Password')
    .strongPassword('password', 'Password')
    .required('confirmPassword', 'Password confirmation')
    .matches('confirmPassword', 'password', 'Password confirmation')
    .throw();
}

export function validateChangePassword(req: Request): void {
  new Validator(req.body)
    .required('currentPassword', 'Current password')
    .required('newPassword', 'New password')
    .minLength('newPassword', 8, 'New password')
    .strongPassword('newPassword', 'New password')
    .required('confirmPassword', 'Password confirmation')
    .matches('confirmPassword', 'newPassword', 'Password confirmation')
    .throw();
}

export function validateRefreshToken(req: Request): void {
  new Validator(req.body).required('refreshToken', 'Refresh token').throw();
}
