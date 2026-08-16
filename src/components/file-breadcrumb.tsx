import { Fragment } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';
import { getFileIcon } from '@/assets/icons';
import { cn, getFileExtension } from '@/lib/utils';

interface FileBreadcrumbProps {
  filePath: string;
  onNavigate?: (path: string) => void;
  className?: string;
}

// Windows paths use backslashes; normalize so splitting/comparison is consistent
function normalize(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export default function FileBreadcrumb({
  filePath,
  onNavigate,
  className,
}: FileBreadcrumbProps) {
  const workspacePath = useWorkspace((s) => s.path);

  if (!workspacePath) return null;

  const normalizedWorkspace = normalize(workspacePath);
  const normalizedFile = normalize(filePath);
  const workspaceName = normalizedWorkspace.split('/').pop() ?? 'Home';

  const relative = normalizedFile.startsWith(normalizedWorkspace)
    ? normalizedFile.slice(normalizedWorkspace.length)
    : normalizedFile;

  const segments = relative.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => ({
    label: segment,
    path: `${normalizedWorkspace}/${segments.slice(0, index + 1).join('/')}`,
    isLast: index === segments.length - 1,
  }));

  const Icon = getFileIcon(getFileExtension(filePath));

  return (
    <Breadcrumb className={cn('min-w-0 max-w-full', className)}>
      <BreadcrumbList className='flex-nowrap overflow-hidden'>
        <BreadcrumbItem className='min-w-0 shrink'>
          {crumbs.length === 0 ? (
            <BreadcrumbPage className='block truncate'>
              {workspaceName}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              href='#'
              className='block truncate'
              onClick={(e) => {
                e.preventDefault();
                onNavigate?.(normalizedWorkspace);
              }}
            >
              {workspaceName}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {crumbs.map((crumb) => (
          <Fragment key={crumb.path}>
            <BreadcrumbSeparator className='shrink-0' />
            <BreadcrumbItem
              className={crumb.isLast ? 'min-w-0 shrink-0' : 'min-w-0 shrink'}
            >
              {crumb.isLast ? (
                <BreadcrumbPage>
                  <div className='flex items-center gap-2 whitespace-nowrap'>
                    <span className='shrink-0'>
                      <Icon />
                    </span>
                    {crumb.label}
                  </div>
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  href='#'
                  className='block truncate'
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate?.(crumb.path);
                  }}
                >
                  {crumb.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
